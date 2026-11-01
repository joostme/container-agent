# fitout

A plain container, fitted out on start. fitout is one small Docker image with [mise](https://mise.jdx.dev) and [pitchfork](https://pitchfork.jdx.dev) inside; you pick tools, apps and services from a catalog, and the container installs and runs them. A remotely controlled coding agent, a JupyterLab, VS Code in the browser, a toolbox with Go and Rust: same image, different config.

You get two things: the image and a config folder (plus a `.env` for secrets). fitout itself is only the go-between: it resolves the modules, hands their tools to mise and their daemons to pitchfork, and sets up the user both run as.

The design and the reasons behind it are in [docs/architecture.md](docs/architecture.md).

## Configurator

[joostme.github.io/fitout](https://joostme.github.io/fitout/) is a static page that writes the whole setup: `compose.yaml`, `.env` with the secrets and the `config/` folder, as a zip, or everything in one `compose.yaml`. It has the catalog built in, builds forms from the variable types, and has an editor for custom modules with a raw TOML view. It loads its own files again. Settings travel in the page link (without secrets); *Share link* on a custom module gives a link that carries just that module, which others see in full, with what runs as root and the secrets it reads, before they add it.

## Quick start

The example is a coding box: Claude Code Remote Control, T3 Code and VS Code in the browser, with the dev tools and zsh.

```bash
cp -r example my-box && cd my-box
cp .env.example .env            # secrets: passwords, tokens
$EDITOR config/fitout.toml      # modules and values; PUID/PGID in compose.yaml
docker compose up -d
docker compose logs -f          # the first start installs all tools

# One-time logins, persisted in the home volume
docker compose exec box fitout run claude      # then /login
docker compose exec box t3-pair                # pair a T3 app
```

`fitout run [command]` runs a command as the user with the mise tools and environment; without a command it opens a login shell.

## Configuration

The image reads one folder, mounted at `/etc/fitout`, on every start:

```
config/
├── fitout.toml           modules and values
└── modules/
    └── java.toml         custom module, same format as in the catalog
```

```toml
#:schema https://raw.githubusercontent.com/joostme/fitout/main/schema/v1/fitout.schema.json
format = 1

# java comes from modules/java.toml, the others from the catalog
modules = ["python", "code-server", "java"]

[env]
MISE_PYTHON_VERSION = "3.13"
```

| Field | Default | |
|---|---|---|
| `format` | required | Version of this format |
| `catalog` | the official one | URL or path of the folder with the module files |
| `modules` | | Enabled modules by name; modules they `require` come along. A file in `modules/` replaces the catalog module of its name |
| `[env]` | | Values of module variables, not secrets |

- A variable in the container environment wins over `[env]`, so Unraid templates or Portainer can set everything as environment variables.
- `PUID` and `PGID` (default `1000`) come from the container environment, as in most images: the owner of the volumes on the host.
- The home `/home/fitout` and the workspace `/workspace`, where daemons run, are the two volumes worth mounting.
- Tools at `latest` (or `lts`, `stable`) are upgraded on every start; pin a version to keep one.
- Secrets (variables of `type = "secret"`) only come from the environment, e.g. `.env`; in `[env]` they stop the start. So `fitout.toml` can live in git.
- Changes need a restart, not a new container.
- Instead of a folder, `compose.yaml` can carry the files with `configs:` and `content:` (Docker Compose 2.23 or later, `$` written as `$$`).

`fitout plan` shows the resolved setup: modules in order, environment (secrets masked), commands, and the generated mise and pitchfork configs.

```bash
docker compose exec box fitout plan
```

Daemons: `fitout run pitchfork list`, `fitout run pitchfork logs <name>`, `fitout run pitchfork restart <name>`. The container turns unhealthy when a daemon has failed.

## Modules

Everything you can enable is a module. **Services** run a process: web UIs, servers, remote control. **Apps** only install and set up: CLIs, runtimes, shells, agents.

```
bun              app      1.0.0    Bun, the JavaScript runtime and package manager
claude           app      1.0.0    Claude Code CLI; log in once with `fitout run claude` and /login
claude-remote    service  1.0.0    Claude Code Remote Control: sessions in claude.ai/code and the Claude apps
code-server      service  1.0.0    VS Code in the browser (code-server), opens the workspace
codex            app      1.0.0    OpenAI Codex CLI, e.g. as a provider in T3 Code
codex-remote     service  1.0.0    Codex Remote Control: sessions in the ChatGPT app, listed under the container's host name
devtools         app      1.0.0    Everyday development tools: git, compilers and make (build-essential), ripgrep, ps and top
gh               app      1.0.0    GitHub CLI (gh); uses GH_TOKEN or GITHUB_TOKEN if set
git              app      1.0.0    Git with less as its pager, trusting every repository in the container
go               app      1.0.0    Go
node             app      1.0.0    Node.js with npm; needed by tools that ship as npm packages
oh-my-zsh        app      1.0.0    Oh My Zsh for the zsh of the user
opencode         service  1.0.0    OpenCode server with its web UI
pnpm             app      1.0.0    pnpm, the Node.js package manager
python           app      1.0.0    Python
rust             app      1.0.0    Rust with cargo, through rustup
ssh              app      1.0.0    SSH client; copies the keys mounted at ~/.ssh-keys into ~/.ssh
sshd             service  1.0.0    SSH server for the user (key login only), e.g. for Remote-SSH from VS Code or Cursor
t3               service  1.0.0    T3 Code server for the T3 web, desktop and mobile apps; drives Claude, Codex, OpenCode and more
uv               app      1.0.0    uv, the Python package and project manager
zsh              app      1.0.0    Zsh as the login shell of the user, with the mise tools in every shell
```

The base image has no git, no compilers and no zsh; the `git`, `devtools`, `ssh` and `zsh` modules bring them, and modules that need one require it (the agents require `git`).

The catalog is the [catalog/](catalog) folder of this repository, one file per module. On every start the image downloads the files of its modules from there (`https://raw.githubusercontent.com/joostme/fitout/main/catalog`), so a merged change reaches containers on their next restart, without an image release. A copy in the home volume keeps the container starting when the catalog is not reachable. To stay on one state of the catalog, set `catalog` to the same URL with a tag or commit instead of `main`.

Runtime apps install a sensible default version. Pick another one with the variable mise reads itself, e.g. `MISE_NODE_VERSION = "22"` in `[env]`.

## Writing a module

A module is one TOML file in three layers: fields of fitout and its variables in `[env]`, a mise config in `[mise]`, and pitchfork daemons in `[daemons]`.

```toml
#:schema https://raw.githubusercontent.com/joostme/fitout/main/schema/v1/module.schema.json
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
- **`[mise]`**: `tools`, `tasks` and in `bootstrap` the apt `packages` and the `post-packages` (as root) and `post-tools` (as the user) hooks. Hooks run on every start, so keep them idempotent. Each task also becomes a command on the `PATH` (`t3-pair` runs `mise run t3-pair`); tasks that take arguments declare them with `usage = 'arg "[args]..." var=#true'` and read `$usage_args`.
- **`[daemons]`**: pitchfork syntax. The image fills in `boot_start = true`, `dir` = the workspace, and the mise tools and environment; daemons run as the user unless `user = "root"`. pitchfork restarts a failed daemon right away, so a daemon that fails fast (e.g. no login yet) should sleep before it exits: `|| { sleep 30; exit 1; }`.

Modules may rely on the user `fitout` with home `/home/fitout`, the workspace `/workspace`, the variables `FITOUT_USER`, `FITOUT_HOME`, `PUID` and `PGID`, and on bash, curl and jq; anything else they install or require.

Modules for the catalog go to `catalog/<name>.toml` by pull request. Their variables start with the module name (`JUPYTER_`, or `MISE_JUPYTER_` for one mise reads itself), tasks and daemons are the module name or start with it and a dash. `version` is for people: raise it when a module changes.

The schema links the mise and pitchfork schemas of the versions in the image, so editors with a TOML language server complete and check all three layers. [Tombi](https://tombi-toml.github.io/tombi/) also flags unknown daemon options such as a misspelled `retry`, which pitchfork would silently ignore. The entrypoint checks the same rules again and stops the start on anything it does not know.

## How a start works

1. Read `fitout.toml`, create the user `fitout` with `PUID`/`PGID` and bash as its shell.
2. Resolve the modules and what they `require`, from `modules/` or the catalog; check them.
3. Set the variables: environment, then `[env]`, then the module defaults.
4. Write the `[mise]` of every module to `/etc/mise/conf.d/` in that order, and a command per task.
5. `mise bootstrap --only packages` as root, then `mise bootstrap --skip packages` as the user (tools and hooks), then `mise upgrade`.
6. Write the `[daemons]` of all modules to `/etc/pitchfork/config.toml` and run the pitchfork supervisor.

The base is Debian slim with only what fitout, mise and pitchfork need: curl, certificates, jq, gosu, unzip and xz. mise, pitchfork and yq are pinned in the `Dockerfile` (Renovate bumps them together with the schema links) and do not update themselves. One image per architecture, `linux/amd64` and `linux/arm64`.

## Development

```bash
mise run lint     # shellcheck, TOML against the schemas (tombi), pinned versions, catalog rules
mise run test     # entrypoint: resolution, checks, values, generated configs
```

```bash
cd web
npm ci
npm run dev       # configurator on http://localhost:5173, with the catalog of the working tree
npm test          # generator, import, links, module order compared with the entrypoint, the page in jsdom
npm run check     # svelte-check
```

Two workflows:

- **Image** (`image.yml`): lint and tests, then builds the image, starts it with the catalog of the same commit until it is healthy, and publishes `linux/amd64` and `linux/arm64` to `ghcr.io/joostme/fitout`, as `latest` from `main`.
- **Configurator** (`pages.yml`): checks the catalog and deploys the configurator, with the catalog built in, to GitHub Pages on every push to `main`.

Renovate bumps mise and pitchfork in the `Dockerfile` and in the schema links in one PR.

## Releases

```bash
git tag v0.3.0 && git push origin v0.3.0
```

A `v*` tag publishes the image as `0.3.0`, `0.3` and `0` and creates a GitHub release with generated notes.

## License

[MIT](LICENSE)
