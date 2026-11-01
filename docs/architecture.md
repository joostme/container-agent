# Architecture

fitout is a generic container environment: one plain image that a config folder fits out on start with tools, apps and services from a catalog. Nobody uses it yet, so breaking changes are still free. What it must not do is force breaking changes later: the module format and the contract between modules and image are the public interface, and they have to stay stable once others write modules.

## Principles

1. **The image is an engine, modules are data.** The image knows how to install, set up and supervise. What gets installed and run comes from modules. No module is special, and the image assumes no use case: coding agents, notebooks and web UIs are all just modules.
2. **A small go-between on mise and pitchfork.** A module contains a mise config and pitchfork daemons as they are, documented by their projects; they do the installing and the supervising. fitout adds only what they do not have: identity, dependencies between modules, variables with forms, the user, and the catalog.
3. **A slim base.** The image carries only what fitout, mise and pitchfork need. Shells, git, compilers and SSH are modules, so a container gets what it asks for and nothing else.
4. **One file per module.** One file to write, review, link, paste, diff and mount.
5. **The catalog is a folder.** The catalog is `catalog/` in this repository, taken as a whole. A merged module reaches containers on their next restart, without an image release; who wants a fixed state points at a tag or commit.
6. **Fail loud.** An unknown field, a missing variable or a cycle stops the start with a clear message instead of being ignored.
7. **One container, one user, one workspace.** Modules share the user, the environment and the network. fitout is not an orchestrator.

## Parts

```
catalog/<name>.toml        modules, reviewed by pull request
schema/v1/                 the module format and the format of fitout.toml
image/                     the engine: entrypoint, mise, pitchfork
web/                       the configurator
```

| Part | Knows | Does not know |
|---|---|---|
| Module | what it needs and runs, in mise and pitchfork terms | other modules' internals |
| Image | the module format, how to run it | any particular module |
| Catalog | the modules and their metadata | the image internals |
| Configurator | the catalog it was built with, the module format | the image internals |

## Configuration of a container

A container is described by one folder, mounted at `/etc/fitout`:

```
config/
├── fitout.toml           modules and values
└── modules/
    └── jupyter.toml      custom module, same format as in the catalog
```

```toml
#:schema https://raw.githubusercontent.com/joostme/fitout/main/schema/v1/fitout.schema.json
format = 1

# jupyter comes from modules/jupyter.toml, the others from the catalog
modules = ["claude-remote", "t3", "code-server", "devtools", "jupyter"]

[env]
CLAUDE_REMOTE_NAME = "nas"
T3_PUBLIC_URL = "https://t3.example.org"
```

`fitout.toml`:

| Field | Default | Meaning |
|---|---|---|
| `format` | required | Version of this format, like `format` in modules. |
| `catalog` | the official one | URL (or path) of the folder with the module files. |
| `modules` | | The enabled modules by name. Modules they `require` come along. |
| `[env]` | | Values of module variables. Not for secrets. |

Rules:

- **One source.** `fitout.toml` is the only place for modules and values; there is no other list.
- **Environment wins.** A variable in the container environment overrides the same key in `[env]`. Platforms that set everything as environment variables (Unraid templates, Portainer) stay fully usable.
- **Container things stay in the container.** `PUID` and `PGID` (default `1000`) come from the environment, as in most images. The home is `/home/fitout`, the workspace `/workspace`; both are fixed paths, mounted wherever the host keeps them.
- **Tools move on.** Tools at `latest` (or `lts`, `stable`) are upgraded on every start; a module or `[env]` pins a version to keep one.
- **Secrets only from the environment.** A value for a `type = "secret"` variable in `[env]` stops the start, so `fitout.toml` can live in git; secrets come from `.env` or the platform.
- **Restart applies changes.** The folder is read on every start; changing it needs a restart, not a new container.
- **Any way of mounting.** A bind mount works with `docker run`, Unraid, Portainer and compose. Who wants a single file can put `fitout.toml` and the modules into `compose.yaml` with `configs:` and `content:` (Docker Compose 2.23 or later, `$` written as `$$`). The image only reads `/etc/fitout`.

`compose.yaml` then holds what only Docker can do:

```yaml
services:
  box:
    image: ghcr.io/joostme/fitout:1
    restart: unless-stopped
    env_file: .env              # secrets: JUPYTER_TOKEN, CODE_SERVER_PASSWORD
    environment:
      PUID: 99
      PGID: 100
    volumes:
      - ./config:/etc/fitout
      - ./data/home:/home/fitout
      - ./data/workspace:/workspace
    ports:
      - 3773:3773
      - 8080:8080
      - 8888:8888
```

## Module format, version 1

A module is one TOML file in three layers:

| Layer | Keys | Defined by |
|---|---|---|
| fitout | top-level fields, `[env]` | this project |
| mise | `[mise]` | [mise](https://mise.jdx.dev/configuration.html): tools, tasks, `bootstrap` packages and hooks |
| pitchfork | `[daemons]` | [pitchfork](https://pitchfork.jdx.dev): long-running processes |

```toml
#:schema https://raw.githubusercontent.com/joostme/fitout/main/schema/v1/module.schema.json
format = 1
name = "t3"
description = "T3 Code server for the T3 web, desktop and mobile apps"
version = "1.0.0"
tags = ["remote control", "ui"]
requires = ["node", "git"]
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

A module that changes the container itself, here the login shell; root work goes into a `post-packages` hook:

```toml
format = 1
name = "zsh"
description = "Zsh as the login shell of the user, with the mise tools in every shell"
version = "1.0.0"

[mise.bootstrap.packages]
"apt:zsh" = "latest"

[mise.bootstrap.hooks.post-packages]
run = 'usermod -s /usr/bin/zsh "$FITOUT_USER"'

[mise.bootstrap.hooks.post-tools]
run = '''
grep -Fq '# fitout zsh' ~/.zshrc 2>/dev/null || printf '\n# fitout zsh\neval "$(mise activate zsh)"\n' >> ~/.zshrc
'''
```

### fitout fields

Top level (all before the first table, as TOML requires):

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Version of this format. The image refuses formats it does not know. |
| `name` | yes | Global id, `^[a-z0-9][a-z0-9-]*$`. In the catalog it equals the file name. It is inside the file so a link or paste carries it. |
| `description` | yes | One line. |
| `version` | catalog: yes | Semver of the module. |
| `tags` | no | Free text, for search. |
| `author`, `homepage` | no | Shown in the catalog. |
| `requires` | no | Modules enabled with this one and set up before it. Entries are module names; `name@range` is reserved for later. |
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

- **`[mise]`** is a mise config. Allowed: `tools`, `tasks` and in `bootstrap` the `packages` and the `hooks`. Not allowed: `env` and `settings`, which would reach across modules and override values from `fitout.toml` and the environment (variables belong in `[env]`), and bootstrap parts that need systemd or a desktop. The schema checks this.
- **`[daemons]`** are pitchfork daemons. The image fills in: `boot_start = true`, `dir = "/workspace"`, `mise = true` (tools and environment of all modules), and the user unless `user = "root"`.
- **Order:** the image writes the `[mise]` of every module to `/etc/mise/conf.d/` in dependency order, so bootstrap hooks run in that order: `post-packages` hooks as root after all packages, `post-tools` hooks as the user after all tools. Daemons from all modules form one pitchfork config; `depends` may name daemons of other modules.
- **Tasks are commands.** Every task of an enabled module also gets a command of its name on the `PATH` (`t3-pair` runs `mise run t3-pair`), so `next_steps` and users can call it directly. Task names start with the module name (`t3-pair` in module `t3`); the catalog enforces it. Tasks that take arguments declare them with mise's `usage` spec (`usage = 'arg "[args]..." var=#true'`) and read them from `$usage_args`, since mise appends plain extra arguments to the end of the script.
- **What pitchfork lacks** is written in shell, as above: a pause before a restart (`|| { sleep 30; exit 1; }`) and waiting for a condition (a `oneshot` daemon others `depends` on). If pitchfork gains such options later, modules can switch to them; nothing in the format depends on it.

### Stability with mise and pitchfork underneath

The image pins mise and pitchfork. Each format version names the versions it was built against, and the schema references their schemas at exactly those versions. A bump of either goes through CI with every catalog module before an image release. When an upstream change breaks module syntax, that is a new format version; images then read the old and the new one for a while, and containers on an old image point `catalog` at a tag of the old state.

## Contract between module and image

What a module may rely on, stable within a format version:

- **Base:** Debian stable slim, `amd64` and `arm64`, with `bash`, `curl`, `ca-certificates`, `jq`, `tar`, `gzip`, `unzip`, `xz`, and mise and pitchfork at the versions of the format. Nothing else: no git, no compilers, no ssh, no zsh. A module installs what it needs itself or requires a module that does (`git`, `devtools`, `ssh`, `zsh`).
- **User:** the unprivileged user `fitout` with `PUID`/`PGID`, home `/home/fitout` on a volume, login shell bash unless a module sets another in a `post-packages` hook; daemons, `post-tools` hooks and tasks run as that user, `post-packages` hooks and daemons with `user = "root"` as root.
- **Workspace:** `/workspace`, the working directory of daemons.
- **Environment, everywhere:** `FITOUT_USER`, `FITOUT_HOME`, `PUID`, `PGID`, all variables of all enabled modules with their defaults applied, and the tools of all modules. `/run/fitout/env` holds them for shells a module sets up.
- **Order on every start:** packages, `post-packages` hooks, tools, `post-tools` hooks, then daemons. Within each step a module comes after the modules it `requires`.
- **Persistence:** the home volume and the workspace survive; everything else, including installed packages and the login shell, is rebuilt from the modules on every new container. Modules keep state under `$FITOUT_HOME/.local/state/<name>/`.
- **Health:** healthy once every daemon that starts on boot runs and passes its ready check.

The image's own duties, not modules: the user and its home, mise in bash shells (interactive and non-interactive), resolving and downloading modules, writing the mise and pitchfork configs, `fitout run`, and the health check. Everything a particular use case needs, such as SSH keys, `git safe.directory` or another shell, is a module.

## Variables

Variables of all modules share one environment, so names must not collide. Catalog modules prefix theirs with the module name in upper case (`t3` → `T3_`); CI enforces it. A variable mise reads itself may carry `MISE_` in front (`MISE_NODE_VERSION` in `node`). The same goes for tasks and daemons: the module name, or the module name and a dash (`t3-pair`). On top, CI refuses a variable, task or daemon that two catalog modules define. `FITOUT_` belongs to the image.

Values come from `[env]` in `fitout.toml` and from the container environment, which wins; secrets only from the environment. A default applies when the value is empty; a `required` variable without value stops the start. Tool versions can come from variables mise reads itself (`MISE_NODE_VERSION`).

## Where modules come from

The image contains no modules. Each name in `modules`, and each module they `require`, comes from:

1. `/etc/fitout/modules/<name>.toml`, if the config folder has it: custom modules and modules from a link. A file there replaces the catalog module of its name.
2. Otherwise the catalog: `<catalog>/<name>.toml`, by default `https://raw.githubusercontent.com/joostme/fitout/main/catalog/<name>.toml`.

The image downloads catalog modules on every start, so a container follows the catalog with each restart, and keeps a copy in the home volume (`~/.cache/fitout/catalog/`). When the catalog is not reachable, it starts from that copy. To stay on one state, `catalog` names a tag or commit instead of `main`, e.g. `https://raw.githubusercontent.com/joostme/fitout/v0.3.0/catalog`. A module in a format the image does not read stops the start.

## Catalog

- `catalog/<name>.toml` in this repository; contributions by pull request.
- CI checks every module: schema, name equals file name, `version` is semver, prefixes of variables, tasks and daemons (`scripts/check-catalog`), resolution through the entrypoint (`tests/run`), and a container start for modules that need no login.
- `version` is for people: it is raised when a module changes and shown in the configurator and in `fitout plan`. Nothing resolves by it.
- Tags are free text; the configurator offers the ones in use for filtering.
- Another catalog is any folder with module files over HTTP, e.g. a fork (`catalog` in `fitout.toml`).

## Configurator

- Deployed on every merge, with the catalog of that commit built in; it fetches nothing.
- The editor has forms for the fitout fields and the common parts of mise and pitchfork (tools, packages, hooks, tasks, daemons with `run`, `retry`, ready checks), plus a raw TOML view for everything else. It edits the parsed file and keeps keys it has no form for, so loading a module and saving it again changes nothing.
- Output: `compose.yaml`, `.env` and the `config/` folder with `fitout.toml` and custom modules, as a zip; or, on request, everything in one `compose.yaml` with `configs:`.
- It loads a `fitout.toml` (or a `compose.yaml` that contains one) and module files again.
- Forms for variables follow their `type`: password fields for `secret`, dropdowns for `choice`, switches for `bool`.
- `compose.yaml` holds only what Docker needs: image, volumes, ports, `.env`. The SSH key mount is offered once the `ssh` module is enabled.

## Sharing

1. **Link:** *Share module* compresses the file (deflate) and puts it base64url-encoded into the URL fragment, `…/#module=<data>`. A typical module is a few hundred characters. Opening it shows the whole file, the root commands and the secrets it reads, with a warning that it comes from an unknown source; *Add* mounts it as a custom module.
2. **Catalog:** reviewed modules, searchable, marked as reviewed, available as soon as they are merged.
3. **More catalogs:** another `catalog` in `fitout.toml`, or several later. Same layout, no review by this project.

Every source shows, before adding, what runs as root (`post-packages` hooks, daemons with `user = "root"`) and which secrets the module reads.

## Versioning

- **MVP phase:** until others use fitout, breaking changes keep `format = 1`. The rules below apply from the first release on.
- **Format:** `format = 1`. Adding optional fields keeps the format; renaming, removing or changing the meaning of a field, or a change of the contract above, means a new format, and images then read the old and the new one for a while. An image refuses unknown fields, so a module using a field from a newer image fails with a message naming the field. A breaking change in mise or pitchfork syntax is a new format version too.
- **Schema:** published per format version (`schema/v1/…`), referencing the mise and pitchfork schemas of the pinned versions.
- **Modules:** semver in `version`, raised on a change; the catalog has one file per module, and its git history keeps the older states.
- **Image:** semver, released only for engine changes. A new format version or a change of the contract above is a major release.

## Decided

- One file per module.
- mise and pitchfork show through: `[mise]` and `[daemons]` use their syntax.
- `[mise]` may contain `tools`, `tasks`, `bootstrap.packages` and `bootstrap.hooks`, nothing else.
- Variables have a `type` instead of `secret` and `port` flags.
- Catalog modules prefix their variables, tasks and daemons with the module name; CI enforces it.
- The catalog is the `catalog/` folder of this repository, taken as a whole; no pins per module. A container follows `main` or a tag or commit.
- Catalog modules are downloaded on every start and cached in the home volume.
- A container is configured by one folder: `fitout.toml` with `modules` (names) and `[env]`, custom modules in `modules/`.
- Environment variables override `[env]`; secrets come only from the environment.
- The user is always `fitout`, home `/home/fitout`; its shell is bash unless a module sets another.
- The base image is slim; git, compilers, SSH and shells are modules.
- Linked modules: preview and warning, no further restriction.
- Tags are free text.
