# Architecture

Status: draft for discussion. It describes the target design; the code still implements an earlier one. Nobody uses container-agent yet, so the target may break anything that exists today. What it must not do is force breaking changes later: the module format and the contract between modules and image are the public interface, and they have to stay stable once others write modules.

## Principles

1. **The image is an engine, modules are data.** The image knows how to install, set up and supervise. What gets installed and run comes from modules. No module is special.
2. **Built on mise and pitchfork, openly.** A module contains a mise config and pitchfork daemons as they are, documented by their projects. container-agent adds only what they do not have: identity, dependencies between modules, variables with forms, and the catalog.
3. **One file per module.** One file to write, review, link, paste, diff and mount.
4. **Engine and modules release separately.** A new or fixed module is available as soon as it is merged into the catalog; an image release happens only when the engine changes.
5. **Pinned, never surprising.** `agent.toml` pins module versions. A container installs exactly those, and a module changes on a server only when someone changes the pin.
6. **Fail loud.** An unknown field, a missing variable or a cycle stops the start with a clear message instead of being ignored.
7. **One container, one user, one workspace.** Modules share the agent user, the environment and the network. container-agent is not an orchestrator.

## Parts

```
catalog/<name>.toml        modules, reviewed by pull request, published on their own
schema/v1/                 the module format and the format of agent.toml
image/                     the engine: entrypoint, mise, pitchfork
web/                       the configurator
```

| Part | Knows | Does not know |
|---|---|---|
| Module | what it needs and runs, in mise and pitchfork terms | other modules' internals |
| Image | the module format, how to run it | any particular module |
| Catalog | the modules and their metadata | the image internals |
| Configurator | the published catalog, the module format | the image internals |

## Configuration of a container

A container is described by one folder, mounted at `/etc/container-agent`:

```
config/
├── agent.toml            modules, versions, values
└── modules/
    └── jupyter.toml      custom module, same format as in the catalog
```

```toml
#:schema https://raw.githubusercontent.com/joostme/container-agent/main/schema/v1/agent.schema.json
format = 1
puid = 99
pgid = 100

[modules]
claude-remote = "1.0.0"   # catalog version
t3 = "1.0.0"
code-server = "1.0.0"
jupyter = "local"         # modules/jupyter.toml

[env]
CLAUDE_REMOTE_NAME = "nas"
T3_PUBLIC_URL = "https://t3.example.org"
```

`agent.toml`:

| Field | Default | Meaning |
|---|---|---|
| `format` | required | Version of this format, like `format` in modules. |
| `puid`, `pgid` | `1000` | UID and GID of the agent user, matching the owner of the volumes on the host. |
| `workspace` | `/repos` | Working directory of the agents and daemons. |
| `auto_update` | `true` | Upgrade tools tracked as `latest` on every start. |
| `catalog` | the official one | URL of the catalog modules are downloaded from. |
| `[modules]` | | The enabled modules: `name = "<version>"` for a catalog module (`"latest"` for the newest compatible one), `name = "local"` for `modules/<name>.toml`. Modules they `require` come along. |
| `[env]` | | Values of module variables. Not for secrets. |

Rules:

- **One source.** `agent.toml` is the only place for modules, versions and values; there is no other list.
- **Environment wins.** A variable in the container environment overrides the same key in `[env]`, and `PUID`, `PGID` override `puid`, `pgid`. Platforms that set everything as environment variables (Unraid templates, Portainer) stay fully usable.
- **Secrets only from the environment.** A value for a `type = "secret"` variable in `[env]` stops the start, so `agent.toml` can live in git; secrets come from `.env` or the platform.
- **Restart applies changes.** The folder is read on every start; changing it needs a restart, not a new container.
- **Any way of mounting.** A bind mount works with `docker run`, Unraid, Portainer and compose. Who wants a single file can put `agent.toml` and the modules into `compose.yaml` with `configs:` and `content:` (Docker Compose 2.23 or later, `$` written as `$$`). The image only reads `/etc/container-agent`.

`compose.yaml` then holds what only Docker can do:

```yaml
services:
  agent:
    image: ghcr.io/joostme/container-agent:1
    restart: unless-stopped
    env_file: .env              # secrets: JUPYTER_TOKEN, CODE_SERVER_PASSWORD
    volumes:
      - ./config:/etc/container-agent
      - ./data/home:/home/agent
      - ./data/repos:/repos
    ports:
      - 3773:3773
      - 8080:8080
      - 8888:8888
```

## Module format, version 1

A module is one TOML file in three layers:

| Layer | Keys | Defined by |
|---|---|---|
| container-agent | top-level fields, `[env]` | this project |
| mise | `[mise]` | [mise](https://mise.jdx.dev/configuration.html): tools, tasks, `bootstrap` packages and hooks |
| pitchfork | `[daemons]` | [pitchfork](https://pitchfork.jdx.dev): long-running processes |

```toml
#:schema https://raw.githubusercontent.com/joostme/container-agent/main/schema/v1/module.schema.json
format = 1
name = "t3"
description = "T3 Code server for the T3 web, desktop and mobile apps"
version = "1.0.0"
tags = ["remote control", "ui"]
requires = ["node"]
after = ["claude", "codex", "opencode"]
next_steps = ["Pair the T3 app: `t3-pair` (set T3_PUBLIC_URL first, so the link works from other devices)"]

[env.T3_PORT]
type = "port"
protocol = "http"
default = "3773"
description = "Port of the T3 server"

[env.T3_PUBLIC_URL]
description = "URL of a reverse proxy in front of the server, used for pairing links"

[mise.tools]
"npm:t3" = "latest"

[mise.bootstrap.packages]
"apt:qrencode" = "latest"

[mise.tasks.t3-pair]
description = "Pairing link and QR code for the T3 apps"
usage = 'arg "[args]..." var=#true help="passed to t3 pair, e.g. --ttl 15m"'
run = '''
out=$(t3 pair $usage_args)
token=$(sed -n 's/^Token: //p' <<< "$out")
url="${T3_PUBLIC_URL%/}/pair#token=$token"
qrencode -t ANSIUTF8 -m 2 "$url"
echo "Pairing URL: $url"
'''

[daemons.t3]
run = 'exec t3 serve --host 0.0.0.0 --port "$T3_PORT" --no-browser'
retry = true
ready_cmd = 'curl -s -o /dev/null "http://127.0.0.1:$T3_PORT/"'
```

A service that waits for a login, with a choice for the configurator's form:

```toml
format = 1
name = "claude-remote"
description = "Claude Code Remote Control: sessions in claude.ai/code and the Claude apps"
version = "1.0.0"
tags = ["remote control", "anthropic"]
requires = ["claude"]

[env.CLAUDE_REMOTE_SPAWN]
type = "choice"
choices = ["same-dir", "worktree"]
default = "same-dir"
description = "Where new sessions run"

[daemons.claude-remote-login]
run = 'until claude auth status > /dev/null 2>&1; do sleep 30; done'
oneshot = true

[daemons.claude-remote]
run = 'claude remote-control --spawn "$CLAUDE_REMOTE_SPAWN" || { sleep 30; exit 1; }'
depends = ["claude-remote-login"]
retry = true
line_retention = 2000
```

### container-agent fields

Top level (all before the first table, as TOML requires):

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Version of this format. The image refuses formats it does not know. |
| `name` | yes | Global id, `^[a-z0-9][a-z0-9-]*$`. In the catalog it equals the file name. It is inside the file so a link or paste carries it. |
| `description` | yes | One line. |
| `version` | catalog: yes | Semver of the module. Raised on every change. |
| `tags` | no | Free text, for search. |
| `author`, `homepage` | no | Shown in the catalog. |
| `requires` | no | Modules enabled with this one and set up before it. Entries are module names; `name@range` is reserved for later. |
| `after` | no | Set up and start after these, if they are enabled. |
| `arch` | no | `amd64`, `arm64`; omitted means both. |
| `next_steps` | no | Shown after the first start; backticks mark commands run in the container. |

`[env.NAME]`, a variable the module reads:

| Field | Meaning |
|---|---|
| `type` | `string` (default), `secret`, `port`, `bool`, `choice`, `path`. Configurators build their forms from it; `secret` values go to `.env`. |
| `default` | Used when the container leaves the variable empty. |
| `required` | The start stops without a value. |
| `choices` | For `choice`. |
| `protocol` | For `port`: `http` or `tcp`. |
| `description` | Shown next to the field. |

### mise and pitchfork, and what the image adds

- **`[mise]`** is a mise config. Allowed: `tools`, `tasks` and in `bootstrap` the `packages` and the `hooks`. Not allowed: `env` and `settings`, which would reach across modules and override values from `agent.toml` and the environment (variables belong in `[env]`), and bootstrap parts that need systemd or a desktop. The schema checks this.
- **`[daemons]`** are pitchfork daemons. The image fills in: `boot_start = true`, `dir` = the workspace, `mise = true` (tools and environment of all modules), and the agent user unless `user = "root"`.
- **Order:** the image writes the `[mise]` of every module to `/etc/mise/conf.d/` in dependency order, so bootstrap hooks run in that order: `post-packages` hooks as root after all packages, `post-tools` hooks as the agent user after all tools. Daemons from all modules form one pitchfork config; `depends` may name daemons of other modules.
- **Tasks are commands.** Every task of an enabled module also gets a command of its name on the `PATH` (`t3-pair` runs `mise run t3-pair`), so `next_steps` and users can call it directly. Task names start with the module name (`t3-pair` in module `t3`); the catalog enforces it. Tasks that take arguments declare them with mise's `usage` spec (`usage = 'arg "[args]..." var=#true'`) and read them from `$usage_args`, since mise appends plain extra arguments to the end of the script.
- **What pitchfork lacks** is written in shell, as above: a pause before a restart (`|| { sleep 30; exit 1; }`) and waiting for a condition (a `oneshot` daemon others `depends` on). If pitchfork gains such options later, modules can switch to them; nothing in the format depends on it.

### Stability with mise and pitchfork underneath

The image pins mise and pitchfork. Each format version names the versions it was built against, and the schema references their schemas at exactly those versions. A bump of either goes through CI with every catalog module before an image release. When an upstream change breaks module syntax, that is a new format version, and images then read the old and the new one for a while; the catalog moves its modules, and the configurator offers only versions that fit the selected image.

## Contract between module and image

What a module may rely on, stable within a format version:

- **Base:** Debian stable, `amd64` and `arm64`, with `bash`, `curl`, `git`, `jq`, `ca-certificates`, `openssh-client`, `build-essential`, `zsh`, and mise and pitchfork at the versions of the format. Anything else a module installs itself.
- **User:** the unprivileged user `agent` with `puid`/`pgid`, home `/home/agent` on a volume; daemons, `post-tools` hooks and tasks run as that user, `post-packages` hooks and daemons with `user = "root"` as root.
- **Environment, everywhere:** `AGENT_HOME`, `AGENT_WORKSPACE`, `PUID`, `PGID`, all variables of all enabled modules with their defaults applied, and the tools of all modules.
- **Order on every start:** packages, `post-packages` hooks, tools, `post-tools` hooks, then daemons. Within each step modules follow `requires` and `after`.
- **Persistence:** the home volume and the workspace survive; everything else, including installed packages, is rebuilt from the modules on every new container. Modules keep state under `$AGENT_HOME/.local/state/<name>/`.
- **Health:** healthy once every daemon that starts on boot runs and passes its ready check.

The image's own duties, not modules: the user, the home, shell setup, SSH keys from `.ssh-keys`, `git safe.directory`, resolving and downloading modules, writing the mise and pitchfork configs, and the health check.

## Variables

Variables of all modules share one environment, so names must not collide. Catalog modules prefix theirs with the module name in upper case (`t3` → `T3_`); CI enforces it. A variable mise reads itself may carry `MISE_` in front (`MISE_NODE_VERSION` in `node`). The same goes for tasks and daemons: the module name, or the module name and a dash (`t3-pair`). On top, CI refuses a variable, task or daemon that two catalog modules define.

Values come from `[env]` in `agent.toml` and from the container environment, which wins; secrets only from the environment. A default applies when the value is empty; a `required` variable without value stops the start. Tool versions can come from variables mise reads itself (`MISE_NODE_VERSION`).

## Where modules come from

The image contains no modules. Each entry in `[modules]` names its source:

| Entry | Source | Use |
|---|---|---|
| `t3 = "1.2.0"` | the catalog, that version | everything reviewed, from the official catalog or another one |
| `jupyter = "local"` | `/etc/container-agent/modules/jupyter.toml` | custom modules and modules from a link |

A module's `requires` are resolved the same way: a local file of that name if one exists, otherwise the newest catalog version compatible with the engine.

### Resolving catalog modules at start

1. `catalog` in `agent.toml` names the catalog, by default the official one on GitHub Pages. It serves an `index.json` and one immutable file per module version.
2. For `name = "<version>"` the entrypoint takes that file from its cache in the home volume (`~/.cache/container-agent/catalog/`) or downloads it, and checks it against the `sha256` in the index.
3. `name = "latest"` means the newest version whose `format` the engine supports. That is handy for trying things out; the configurator always writes pinned versions.
4. A pinned version the engine cannot read (a newer `format`) stops the start with a message naming the version and the image that supports it.

The container needs the network at first start anyway, to install tools; module files add a few kilobytes to that. Restarts work offline from the cache.

## Catalog

- Source: `catalog/<name>.toml` in this repository; contributions by pull request.
- CI checks every changed module: schema, name equals file name, prefixes of variables, tasks and daemons, `version` raised against the base of the pull request or push (`scripts/check-catalog`), resolution through the entrypoint (`tests/run`), and a container start for modules that need no login.
- On every merge CI publishes the catalog to GitHub Pages, independent of image releases:
  - `catalog/<name>/<version>.toml` for every version a module ever had, rebuilt from the git history, so pins never break;
  - `catalog/index.json` with name, description, tags, kind (service if it has daemons, app otherwise), author and, per version, `format`, `sha256` and the date.
  - A version is immutable: if a published version shows up again with other content (a push that skipped the check), the first content stays and the build warns.
- Tags are free text; the configurator offers the ones in use for filtering.
- Other catalogs use the same layout, so anyone can host one (`catalog` in `agent.toml`).

## Configurator

- Deployed with the catalog on every merge; it reads `index.json` and so always knows every module and version.
- The image tag only selects the engine. The configurator knows which `format` each engine release reads (from `FORMATS` in the entrypoint of every `v*` tag, collected at build time) and offers only module versions that fit.
- The editor has forms for the container-agent fields and the common parts of mise and pitchfork (tools, packages, hooks, tasks, daemons with `run`, `retry`, ready checks), plus a raw TOML view for everything else. It edits the parsed file and keeps keys it has no form for, so loading a module and saving it again changes nothing.
- Output: `compose.yaml`, `.env` and the `config/` folder with `agent.toml` and custom modules, as a zip; or, on request, everything in one `compose.yaml` with `configs:`.
- Loading an `agent.toml` (or a `compose.yaml` that contains one) shows newer versions of its catalog modules, with a diff, and updates the pins on request.
- Forms for variables follow their `type`: password fields for `secret`, dropdowns for `choice`, switches for `bool`.
- `compose.yaml` holds only what Docker needs: image, volumes, ports, `.env`.

## Sharing

1. **Link:** *Share module* compresses the file (deflate) and puts it base64url-encoded into the URL fragment, `…/#module=<data>`. A typical module is a few hundred characters. Opening it shows the whole file, the root commands and the secrets it reads, with a warning that it comes from an unknown source; *Add* mounts it as a custom module.
2. **Catalog:** reviewed modules, searchable, marked as reviewed, available as soon as they are merged.
3. **More catalogs:** another `catalog` in `agent.toml`, or several later. Same layout, no review by this project.

Every source shows, before adding, what runs as root (`post-packages` hooks, daemons with `user = "root"`) and which secrets the module reads.

## Versioning

- **Format:** `format = 1`. Adding optional fields keeps format 1; renaming, removing or changing the meaning of a field means format 2, and images then support 1 and 2 for a while. An image refuses unknown fields, so a module using a field from a newer image fails with a message naming the field. A breaking change in mise or pitchfork syntax is a new format version too.
- **Schema:** published per format version (`schema/v1/…`), referencing the mise and pitchfork schemas of the pinned versions.
- **Modules:** semver in `version`, one immutable file per version in the published catalog. Each module releases on its own.
- **Image:** semver, released only for engine changes. A new format version or a change of the contract above is a major release.

## Decided

- One file per module.
- mise and pitchfork show through: `[mise]` and `[daemons]` use their syntax.
- `[mise]` may contain `tools`, `tasks`, `bootstrap.packages` and `bootstrap.hooks`, nothing else in version 1.
- Variables have a `type` instead of `secret` and `port` flags.
- Catalog modules prefix their variables, tasks and daemons with the module name; CI enforces it.
- The catalog lives in this repository but is released on its own, not with the image.
- Catalog modules are downloaded at start by pinned version, checked against the index and cached in the home volume.
- A container is configured by one folder: `agent.toml` with `[modules]` (catalog version or `local`) and `[env]`, custom modules in `modules/`. No `AGENT_MODULES`, no user modules in the home volume.
- Environment variables override `[env]`; secrets come only from the environment.
- The agent user is always `agent`, home `/home/agent`.
- All current modules move into the catalog.
- Linked modules: preview and warning, no further restriction.
- Tags are free text.

## From today to version 1

1. Schemas v1 for modules and `agent.toml`; the entrypoint: reading `/etc/container-agent`, one file per module, `[mise]` to `conf.d`, `[daemons]` with defaults, tasks as commands, `format` check, fixed user `agent`.
2. Move the 17 modules to `catalog/<name>.toml` in format 1; `t3-pair` and `codex-pair` become mise tasks (`codex-pair` as `codex-remote-pair`, after its module).
3. Catalog CI: checks, all versions and `index.json` on Pages; downloading, checking and caching in the entrypoint.
4. Configurator: `agent.toml` and the config folder as output, editor on the module format with raw TOML view, forms by `type`, pinned versions, update offers.
5. Sharing by link.
