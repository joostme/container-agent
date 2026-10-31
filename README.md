# container-agent

One Docker image for coding agents you control remotely: Claude Code Remote Control, T3 Code, OpenCode, Codex, code-server and more. A folder with an `agent.toml` says which modules run; tools come from [mise](https://mise.jdx.dev), long-running processes are supervised by [pitchfork](https://pitchfork.jdx.dev).

The design and the reasons behind it are in [docs/architecture.md](docs/architecture.md).

## Configurator

[joostme.github.io/container-agent](https://joostme.github.io/container-agent/) is a static page that writes the whole setup: `compose.yaml`, `.env` with the secrets and the `config/` folder, as a zip, or everything in one `compose.yaml`. It reads the catalog, offers only module versions the chosen image reads, builds forms from the variable types, and has an editor for custom modules with a raw TOML view. It loads its own files again and offers updates of pinned modules with their changes. Settings travel in the page link (without secrets); *Share link* on a custom module gives a link that carries just that module, which others see in full, with what runs as root and the secrets it reads, before they add it.

## Quick start

```bash
cp -r example my-agent && cd my-agent
cp .env.example .env            # secrets: passwords, tokens
$EDITOR config/agent.toml       # modules, puid/pgid, values
docker compose up -d
docker compose logs -f          # the first start installs all tools

# One-time logins, persisted in the home volume
docker compose exec agent agent-run claude      # then /login
docker compose exec agent t3-pair               # pair a T3 app
```

`agent-run [command]` runs a command as the agent user with the mise tools and environment; without a command it opens a shell.

## Configuration

The image reads one folder, mounted at `/etc/container-agent`, on every start:

```
config/
├── agent.toml            modules, versions, values
└── modules/
    └── java.toml         custom module, same format as in the catalog
```

```toml
#:schema https://raw.githubusercontent.com/joostme/container-agent/main/schema/v1/agent.schema.json
format = 1
puid = 1000
pgid = 1000

[modules]
claude-remote = "1.0.0"   # catalog version, or "latest"
t3 = "1.0.0"
java = "local"            # modules/java.toml

[env]
CLAUDE_REMOTE_NAME = "nas"
T3_PUBLIC_URL = "https://t3.example.org"
```

| Field | Default | |
|---|---|---|
| `format` | required | Version of this format |
| `puid`, `pgid` | `1000` | UID and GID of the agent user, matching the owner of the volumes on the host |
| `workspace` | `/repos` | Working directory of the agents and daemons |
| `auto_update` | `true` | Upgrade tools tracked as `latest` on every start |
| `catalog` | the official one | URL or path of the catalog modules come from |
| `[modules]` | | Enabled modules; modules they `require` come along |
| `[env]` | | Values of module variables, not secrets |

- A variable in the container environment wins over `[env]`, and `PUID`/`PGID` over `puid`/`pgid`, so Unraid templates or Portainer can set everything as environment variables.
- Secrets (variables of `type = "secret"`) only come from the environment, e.g. `.env`; in `[env]` they stop the start. So `agent.toml` can live in git.
- Changes need a restart, not a new container.
- Instead of a folder, `compose.yaml` can carry the files with `configs:` and `content:` (Docker Compose 2.23 or later, `$` written as `$$`).

`container-agent plan` shows the resolved setup: modules in order, environment (secrets masked), commands, and the generated mise and pitchfork configs.

```bash
docker compose exec agent container-agent plan
```

Daemons: `agent-run pitchfork list`, `agent-run pitchfork logs <name>`, `agent-run pitchfork restart <name>`. The container turns unhealthy when a daemon has failed.

## Modules

Everything you can enable is a module. **Services** run a process: remote control, web UIs, servers. **Apps** only install and set up: agents, CLIs and runtimes.

```
$ docker run --rm ghcr.io/joostme/container-agent modules
bun              app      1.0.0    Bun, the JavaScript runtime and package manager
claude           app      1.0.0    Claude Code CLI; log in once with `agent-run claude` and /login
claude-remote    service  1.0.0    Claude Code Remote Control: sessions in claude.ai/code and the Claude apps
code-server      service  1.0.0    VS Code in the browser (code-server), opens the workspace
codex            app      1.0.0    OpenAI Codex CLI, e.g. as a provider in T3 Code
codex-remote     service  1.0.0    Codex Remote Control: sessions in the ChatGPT app, listed under the container's host name
gh               app      1.0.0    GitHub CLI (gh); uses GH_TOKEN or GITHUB_TOKEN if set
go               app      1.0.0    Go
node             app      1.0.0    Node.js with npm; needed by agents that ship as npm packages
oh-my-zsh        app      1.0.0    Oh My Zsh for the agent user's zsh
opencode         service  1.0.0    OpenCode server with its web UI
pnpm             app      1.0.0    pnpm, the Node.js package manager
python           app      1.0.0    Python
rust             app      1.0.0    Rust with cargo, through rustup
sshd             service  1.0.0    SSH server for the agent user (key login only), e.g. for Remote-SSH from VS Code or Cursor
t3               service  1.0.0    T3 Code server for the T3 web, desktop and mobile apps; drives Claude, Codex, OpenCode and more
uv               app      1.0.0    uv, the Python package and project manager
```

The catalog lives in [catalog/](catalog) and is released on its own, independent of the image. On start the image downloads the pinned version of each module, checks it against the `sha256` in the catalog index and caches it in the home volume, so a container with pinned modules also starts when the catalog is unreachable.

Runtime apps install a sensible default version. Pick another one with the variable mise reads itself, e.g. `MISE_NODE_VERSION = "22"` in `[env]`.

## Writing a module

A module is one TOML file in three layers: fields of container-agent and its variables in `[env]`, a mise config in `[mise]`, and pitchfork daemons in `[daemons]`.

```toml
#:schema https://raw.githubusercontent.com/joostme/container-agent/main/schema/v1/module.schema.json
format = 1
name = "jupyter"
description = "JupyterLab"
version = "1.0.0"
requires = ["uv"]
next_steps = ["Open JupyterLab on JUPYTER_PORT and sign in with JUPYTER_TOKEN"]

[env.JUPYTER_PORT]
type = "port"
protocol = "http"
default = "8888"

[env.JUPYTER_TOKEN]
type = "secret"
required = true

[mise.tools]
"pipx:jupyterlab" = "latest"

[daemons.jupyter]
run = 'exec jupyter lab --ip 0.0.0.0 --port "$JUPYTER_PORT" --IdentityProvider.token="$JUPYTER_TOKEN"'
retry = true
ready_cmd = 'curl -s -o /dev/null "http://127.0.0.1:$JUPYTER_PORT/"'
```

- **`[env]`**: variables with `type` (`string`, `secret`, `port`, `bool`, `choice`, `path`), `default`, `required`, `choices`, `protocol` and `description`.
- **`[mise]`**: `tools`, `tasks` and in `bootstrap` the apt `packages` and the `post-packages` (as root) and `post-tools` (as the agent user) hooks. Hooks run on every start, so keep them idempotent. Each task also becomes a command on the `PATH` (`t3-pair` runs `mise run t3-pair`); tasks that take arguments declare them with `usage = 'arg "[args]..." var=#true'` and read `$usage_args`.
- **`[daemons]`**: pitchfork syntax. The image fills in `boot_start = true`, `dir` = the workspace, and the mise tools and environment; daemons run as the agent user unless `user = "root"`. pitchfork restarts a failed daemon right away, so a daemon that fails fast (e.g. no login yet) should sleep before it exits: `|| { sleep 30; exit 1; }`.

Modules for the catalog go to `catalog/<name>.toml` by pull request. Their variables start with the module name (`JUPYTER_`, or `MISE_JUPYTER_` for one mise reads itself), tasks and daemons are the module name or start with it and a dash, and every change raises `version`. A published version never changes; the catalog keeps every version a module ever had.

The schema links the mise and pitchfork schemas of the versions in the image, so editors with a TOML language server complete and check all three layers. [Tombi](https://tombi-toml.github.io/tombi/) also flags unknown daemon options such as a misspelled `retry`, which pitchfork would silently ignore. The entrypoint checks the same rules again and stops the start on anything it does not know.

## How a start works

1. Read `agent.toml`, create the user `agent` with `puid`/`pgid`.
2. Resolve the modules with `requires` and `after`, from `modules/` or the catalog; check them.
3. Set the variables: environment, then `[env]`, then the module defaults.
4. Write the `[mise]` of every module to `/etc/mise/conf.d/` in that order, and a command per task.
5. `mise bootstrap --only packages` as root, then `mise bootstrap --skip packages` as the agent user (tools and hooks); `mise upgrade` if `auto_update`.
6. Write the `[daemons]` of all modules to `/etc/pitchfork/config.toml` and run the pitchfork supervisor.

mise, pitchfork and yq are pinned in the `Dockerfile` (Renovate bumps them together with the schema links) and do not update themselves. One Debian image per architecture, `linux/amd64` and `linux/arm64`; a module that works on only one says so with `arch`.

## Development

```bash
mise run lint     # shellcheck, TOML against the schemas (tombi), pinned versions, catalog rules
mise run test     # entrypoint: resolution, checks, values, generated configs; catalog history
scripts/check-catalog origin/main   # also: every changed module raised its version
```

```bash
cd web
npm ci
npm run dev       # configurator on http://localhost:5173, with the catalog built from git
npm test          # generator, import, links, module order compared with the entrypoint, the page in jsdom
npm run check     # svelte-check
```

Two workflows:

- **Image** (`image.yml`): lint and tests, then builds the image, starts it with a catalog built from the same commit until it is healthy, and publishes `linux/amd64` and `linux/arm64` to `ghcr.io/joostme/container-agent`, as `latest` from `main`.
- **Catalog and configurator** (`pages.yml`): checks the catalog against the previous commit or the pull request base, builds every module version from the git history and the configurator, and deploys both to GitHub Pages on every push to `main`. Image releases are not needed for catalog changes.

Renovate bumps mise and pitchfork in the `Dockerfile` and in the schema links in one PR.

## Releases

```bash
git tag v0.3.0 && git push origin v0.3.0
```

A `v*` tag publishes the image as `0.3.0`, `0.3` and `0` and creates a GitHub release with generated notes. It also deploys the configurator again, which then offers the new version with the module formats its entrypoint reads.

## License

[MIT](LICENSE)
