# container-agent

One Docker image for coding agents you control remotely: Claude Code Remote Control, T3 Code, OpenCode, code-server and more. You pick what runs with `AGENT_MODULES`; tools come from [mise](https://mise.jdx.dev), long-running processes are supervised by [pitchfork](https://pitchfork.jdx.dev).

## Configurator

`web/` is a static page that turns picked modules and their settings into `compose.yaml` and `.env`, with the steps after the first start. It keeps secrets in `.env`, can load its own `compose.yaml` again, and puts the settings (without secrets) into a shareable link. Each release attaches its build as `configurator.tar.gz`; serve it from any static host, e.g. GitHub Pages or Cloudflare Pages, also under a sub-path.

## Quick start

```bash
cp compose.example.yaml compose.yaml
cp .env.example .env            # set PUID/PGID, AGENT_MODULES, passwords
docker compose up -d
docker compose logs -f          # the first start installs all tools

# One-time logins, persisted in the home volume
docker compose exec agent agent-run claude      # then /login
docker compose exec agent t3-pair               # pair a T3 app
docker compose exec agent codex-pair            # pair the ChatGPT app with Codex
```

`agent-run [command]` runs a command as the agent user with the mise tools and environment; without a command it opens a shell.

## Modules

```
$ docker run --rm ghcr.io/joostme/container-agent modules
claude           Claude Code CLI; log in once with `agent-run claude` and /login
claude-remote    Claude Code Remote Control: sessions in claude.ai/code and the Claude apps
code-server      VS Code in the browser (code-server), opens the workspace
codex            OpenAI Codex CLI, e.g. as a provider in T3 Code; log in with `agent-run codex login --device-auth`
codex-remote     Codex Remote Control: sessions in the ChatGPT app, listed under the container's host name; pair with `codex-pair`
gh               GitHub CLI (gh); uses GH_TOKEN or GITHUB_TOKEN if set
oh-my-zsh        Oh My Zsh for the agent user's zsh
opencode         OpenCode server with its web UI
sshd             SSH server for the agent user (key login only), e.g. for Remote-SSH from VS Code or Cursor
t3               T3 Code server for the T3 web, desktop and mobile apps; drives Claude, Codex, OpenCode and more
```

Modules a module `requires` are enabled with it (`claude-remote` brings `claude`). Each module documents its variables, defaults and ports in its `module.toml`; `container-agent plan` shows the resolved setup:

```bash
docker compose exec agent container-agent plan
```

## Configuration

| Variable | Default | |
|---|---|---|
| `AGENT_MODULES` | | Comma-separated modules to enable |
| `PUID`, `PGID` | `1000` | UID/GID of the agent user, match your host user |
| `AGENT_USER` | `agent` | Name of the agent user, home is `/home/$AGENT_USER` |
| `AGENT_WORKSPACE` | `/repos` | Working directory of the agents and daemons |
| `AUTO_UPDATE` | `true` | Upgrade tools tracked as `latest` on every start |

Your own setup lives in the home volume and survives image updates:

- **Tools and env vars:** `~/.config/mise/config.toml`. It overrides the modules, e.g. `opencode = "1"` to stay on OpenCode 1. `[env]` values reach all daemons and shells.
- **apt packages:** `[bootstrap.packages]` in the same file, e.g. `"apt:ffmpeg" = "latest"`. They are installed on start.
- **Daemons:** `~/.config/pitchfork/config.toml`, in pitchfork syntax.
- **Modules:** `~/.config/container-agent/modules/<name>/`. A module with the name of a built-in one replaces it.

Daemons: `agent-run pitchfork list`, `agent-run pitchfork logs <name>`, `agent-run pitchfork restart <name>`. The container turns unhealthy when a daemon has failed.

## Writing a module

A module is a directory with two files:

```
modules/t3/
├── module.toml   # what the container does with it: metadata, variables, daemons
├── mise.toml     # what gets installed: tools, apt packages, setup hooks (plain mise)
└── bin/          # optional: executables put on the PATH, e.g. t3-pair
```

`module.toml` has a JSON schema, so editors with a TOML language server complete and check it. For daemons it links the schema of the pitchfork version in the image. [Tombi](https://tombi-toml.github.io/tombi/) also flags unknown daemon options such as a misspelled `retry`; Taplo (Even Better TOML) completes them but lets typos through, and pitchfork ignores unknown options silently. Put this in the first line, with the version of the image the module is for:

```toml
#:schema https://raw.githubusercontent.com/joostme/container-agent/v0.1.0/schema/module.schema.json
description = "T3 Code server"
after = ["claude", "codex", "opencode"]   # set up and start after these, if enabled
# requires = ["claude"]                   # enable these too, set them up first
next_steps = ["Pair a device: `t3-pair`"] # shown by the configurator; `commands` run in the container

[env.T3_PORT]
default = "3773"   # used when the container leaves it empty
port = "http"      # for configurators: published port and protocol
# required = true  # refuse to start without a value
# secret = true    # password or token

[daemons.t3]       # pitchfork syntax
run = 'exec t3 serve --host 0.0.0.0 --port "$T3_PORT" --no-browser'
retry = true
ready_cmd = 'curl -s -o /dev/null "http://127.0.0.1:$T3_PORT/"'
```

Daemons run as the agent user through `mise x`, in `AGENT_WORKSPACE`, and start on boot; set `user = "root"`, `mise = false`, `dir` or `boot_start = false` to change that. Reference variables as `$VAR` in `run`, it is a shell command. pitchfork restarts a failed daemon right away, so a daemon that fails fast (e.g. no login yet) should sleep before it exits.

In `mise.toml`, hooks set things up on every start, so keep them idempotent:

- `[bootstrap.hooks.post-packages]` runs as **root**, after the apt packages (e.g. write `/etc/ssh/sshd_config.d/`)
- `[bootstrap.hooks.post-tools]` and `final` run as the **agent user**, after the tools are installed

Hooks see `AGENT_USER`, `AGENT_HOME`, `AGENT_WORKSPACE` and the module variables. Their order follows the module order.

## How a start works

1. Create the agent user from `PUID`/`PGID`.
2. Resolve `AGENT_MODULES` with `requires` and `after`; set variable defaults.
3. Copy the `mise.toml` of every module to `/etc/mise/conf.d/`, in that order.
4. `mise bootstrap --only packages` as root, then `mise bootstrap --skip packages` as the agent user (tools and hooks); `mise upgrade` if `AUTO_UPDATE`.
5. Write the `[daemons]` of all modules to `/etc/pitchfork/config.toml` and run `pitchfork supervisor run --container --boot`.

mise, pitchfork and yq are pinned in the `Dockerfile` (Renovate bumps them) and do not update themselves. One Debian image per architecture, `linux/amd64` and `linux/arm64`; a module that works on only one says so with `arch`.

## Development

```bash
mise run lint     # shellcheck, TOML against the schemas (tombi), pinned versions match
mise run test     # module resolution and generated pitchfork config
```

```bash
cd web
npm ci
npm run dev       # configurator on http://localhost:5173, registry built from ../modules
npm test          # generator tests, module order compared with the entrypoint
npm run check     # svelte-check
```

Renovate bumps pitchfork in the `Dockerfile` and in the schema link in one PR. The CI builds the image, starts it with a few modules until it is healthy, and publishes `linux/amd64` and `linux/arm64` to `ghcr.io/joostme/container-agent`.

## Releases

```bash
git tag v0.1.0 && git push origin v0.1.0
```

A `v*` tag publishes the image as `0.1.0`, `0.1` and `0` (pushes to `main` publish `latest`), then creates a GitHub release with generated notes and two files:

- `registry.json`: the modules of this version, with their variables, ports and next steps; the configurator is built from it
- `configurator.tar.gz`: the configurator for this version, generating `compose.yaml` with the image tag `0.1.0`

## License

[MIT](LICENSE)
