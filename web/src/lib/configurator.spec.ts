import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { describe as suite, expect, it } from "vitest";
import { catalog } from "./catalog";
import { defaultConfig, generate } from "./generate";
import {
  describe,
  emptyModule,
  FORMAT,
  fromToml,
  problems,
  toToml,
} from "./module";
import { resolve } from "./resolve";
import {
  decodeHash,
  encodeConfig,
  encodeModule,
  importFiles,
  review,
  unpack,
} from "./share";
import type { Config, Doc } from "./types";

const root = resolvePath(import.meta.dirname, "../../..");

const configWith = (
  modules: string[],
  extra: Partial<Config> = {},
): Config => ({
  ...defaultConfig(),
  modules,
  ...extra,
});

const run = (config: Config) => {
  const custom = new Map(
    config.custom.map((doc) => [String(doc.name), describe(doc)]),
  );
  const resolution = resolve(config, catalog, custom);
  const output = generate(config, resolution, catalog);
  const file = (path: string) =>
    output.files.find((f) => f.path === path)?.text ?? "";
  return { resolution, output, file };
};

const jupyter: Doc = {
  format: 1,
  name: "jupyter",
  description: "JupyterLab",
  requires: ["uv"],
  env: {
    JUPYTER_TOKEN: { type: "secret", required: true },
    JUPYTER_PORT: { type: "port", protocol: "http", default: "8888" },
  },
  mise: {
    tools: { "pipx:jupyterlab": "latest" },
    bootstrap: { hooks: { "post-packages": { run: "echo root\necho twice" } } },
  },
  daemons: {
    jupyter: { run: "exec jupyter lab", retry: true, ready_cmd: "true" },
  },
};

/** Setup order the entrypoint computes for a fitout.toml. */
function entrypointOrder(
  configToml: string,
  modules: Record<string, string> = {},
): string[] {
  const dir = mkdtempSync(join(tmpdir(), "configurator-"));
  mkdirSync(join(dir, "modules"));
  writeFileSync(
    join(dir, "fitout.toml"),
    configToml.replace(
      /^format = 1$/m,
      `format = 1\ncatalog = "${join(root, "catalog")}"`,
    ),
  );
  for (const [name, text] of Object.entries(modules))
    writeFileSync(join(dir, "modules", `${name}.toml`), text);
  const out = execFileSync(join(root, "image/fitout"), ["plan"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      FITOUT_CONFIG: dir,
      FITOUT_CACHE: join(dir, "cache"),
      OPENCODE_SERVER_PASSWORD: "x",
      JUPYTER_TOKEN: "x",
    },
  });
  const section = out.split("\n\n")[0].split("\n").slice(1);
  return section.map((line) => line.split(/\s+/)[0]);
}

suite("catalog", () => {
  it("bundles every module of the repository, readable by the image", () => {
    expect(catalog.size).toBeGreaterThan(10);
    for (const module of catalog.values()) {
      expect(module.format).toBe(FORMAT);
      expect(problems(module.doc)).toEqual([]);
      expect(fromToml(toToml(module.doc))).toEqual(module.doc);
    }
  });

  it("reads the format the entrypoint reads", () => {
    expect(
      execFileSync("grep", ["^FORMATS=", join(root, "image/fitout")], {
        encoding: "utf8",
      }).trim(),
    ).toBe(`FORMATS="${FORMAT}"`);
  });
});

suite("resolve", () => {
  it("enables required modules and orders them", () => {
    const { resolution } = run(configWith(["t3", "claude-remote"]));
    expect(resolution.order.map((m) => m.name)).toEqual([
      "node",
      "ssh",
      "git",
      "claude",
      "claude-remote",
      "t3",
    ]);
    expect(resolution.requiredBy.get("claude")).toEqual(["claude-remote"]);
  });

  it("reports unknown modules", () => {
    expect(run(configWith(["nope", "gh"])).resolution.unknown).toEqual([
      "nope",
    ]);
  });

  it("takes a custom module before the catalog", () => {
    const custom = { ...emptyModule("uv"), description: "my uv" };
    const { resolution } = run(configWith([], { custom: [jupyter, custom] }));
    expect(resolution.source.get("uv")).toBe("local");
    expect(resolution.order.map((m) => m.name)).toEqual(["uv", "jupyter"]);
  });

  it("orders like the entrypoint", () => {
    const sets = [
      ["t3", "claude-remote", "codex", "opencode"],
      ["codex-remote", "pnpm", "sshd", "oh-my-zsh"],
      [...catalog.keys()],
    ];
    for (const names of sets) {
      const { resolution, file } = run(configWith(names));
      expect(resolution.order.map((m) => m.name)).toEqual(
        entrypointOrder(file("config/fitout.toml")),
      );
    }
    const { resolution, file } = run(configWith(["t3"], { custom: [jupyter] }));
    expect(resolution.order.map((m) => m.name)).toEqual(
      entrypointOrder(file("config/fitout.toml"), { jupyter: toToml(jupyter) }),
    );
  }, 60_000);
});

suite("generate", () => {
  it("lists picked and custom modules, values and secrets apart", () => {
    const { file } = run(
      configWith(["claude-remote", "opencode"], {
        values: {
          CLAUDE_REMOTE_NAME: "nas",
          OPENCODE_SERVER_PASSWORD: "s3cret",
          OPENCODE_PORT: "4096",
        },
        custom: [jupyter],
      }),
    );
    const settings = file("config/fitout.toml");
    const doc = parseToml(settings) as Doc;
    expect(doc.modules).toEqual(["claude-remote", "jupyter", "opencode"]);
    expect(settings).toContain(
      "# required by these, so enabled too: node, ssh, git, claude, uv",
    );
    expect(doc.env).toEqual({ CLAUDE_REMOTE_NAME: "nas" });
    expect(file(".env")).toContain("OPENCODE_SERVER_PASSWORD=s3cret");
    expect(file(".env")).toContain("JUPYTER_TOKEN=");
    expect(fromToml(file("config/modules/jupyter.toml"))).toEqual(jupyter);
  });

  it("writes compose.yaml with the config folder, ports and .env", () => {
    const { file } = run(
      configWith(["t3", "code-server"], { tz: "Europe/Berlin" }),
    );
    const service = (
      parseYaml(file("compose.yaml")) as {
        services: Record<string, Record<string, unknown>>;
      }
    ).services.box;
    expect(service.image).toBe("ghcr.io/joostme/fitout:latest");
    expect(service.volumes).toContain("./config:/etc/fitout:ro");
    expect(service.ports).toEqual(["8080:8080", "3773:3773"]);
    expect(service.env_file).toBe(".env");
    expect(service.environment).toEqual({
      PUID: "1000",
      PGID: "1000",
      TZ: "Europe/Berlin",
    });
  });

  it("mounts SSH keys only for the ssh module", () => {
    const volumes = (modules: string[]) =>
      (
        parseYaml(
          run(configWith(modules, { sshKeys: "~/.ssh" })).file("compose.yaml"),
        ) as {
          services: Record<string, { volumes: string[] }>;
        }
      ).services.box.volumes;
    expect(volumes(["code-server"])).not.toContain(
      "~/.ssh:/home/fitout/.ssh-keys:ro",
    );
    // gh requires git, git requires ssh
    expect(volumes(["gh"])).toContain("~/.ssh:/home/fitout/.ssh-keys:ro");
  });

  it("puts everything into compose.yaml when inline", () => {
    const { output, file } = run(
      configWith(["gh"], { inline: true, custom: [jupyter] }),
    );
    expect(output.files.map((f) => f.path)).toEqual(["compose.yaml", ".env"]);
    const doc = parseYaml(file("compose.yaml")) as {
      configs: Record<string, { content: string }>;
    };
    expect(Object.keys(doc.configs)).toEqual([
      "box-fitout-toml",
      "box-modules-jupyter-toml",
    ]);
    expect(doc.configs["box-modules-jupyter-toml"].content).not.toMatch(
      /[^$]\$[^$]/,
    );
  });

  it("warns about missing values, port clashes and broken custom modules", () => {
    const broken = {
      format: 1,
      name: "Bad",
      description: "x",
      mise: { env: { A: "1" } },
    };
    const { output } = run(
      configWith(["opencode", "code-server"], {
        values: { OPENCODE_PORT: "8080" },
        custom: [broken],
      }),
    );
    expect(output.warnings).toEqual(
      expect.arrayContaining([
        "OPENCODE_SERVER_PASSWORD is required by opencode; the container will not start without it.",
        "Port 8080 is used by CODE_SERVER_PORT and OPENCODE_PORT.",
        "Bad: mise.env is not allowed.",
        "Bad: the name may only contain lower-case letters, digits and dashes.",
      ]),
    );
  });

  it("turns next steps into commands for the service", () => {
    const { output } = run(configWith(["t3"], { service: "nas" }));
    expect(
      output.steps
        .flatMap((s) => s.parts)
        .filter((p) => p.command)
        .map((p) => p.text),
    ).toContain("docker compose exec nas t3-pair");
  });
});

suite("module", () => {
  it("writes scripts as multi-line strings", () => {
    expect(toToml(jupyter)).toContain("run = '''\necho root\necho twice'''");
  });

  it("flags what the entrypoint refuses", () => {
    expect(
      problems({
        format: 2,
        name: "x",
        description: "x",
        foo: 1,
        env: { lower: {}, X_C: { type: "choice" } },
        mise: {
          bootstrap: {
            packages: { "brew:x": "latest" },
            hooks: { "pre-tools": { run: "x" } },
          },
        },
      }),
    ).toEqual([
      "format 2; the image reads format 1",
      "unknown field foo",
      "hook pre-tools is not allowed",
      "package brew:x is not an apt package",
      "variable lower must be upper case, e.g. MY_TOKEN",
      "X_C: a choice needs choices",
    ]);
  });
});

suite("share", () => {
  it("keeps the settings in the link, without secrets", () => {
    const config = configWith(["opencode"], {
      values: { OPENCODE_SERVER_PASSWORD: "secret", OPENCODE_PORT: "5000" },
      custom: [jupyter],
    });
    const hash = encodeConfig(config, new Set(["OPENCODE_SERVER_PASSWORD"]));
    const decoded = decodeHash(`#${hash}`);
    expect(decoded.kind).toBe("config");
    if (decoded.kind !== "config") return;
    expect(decoded.config).toEqual({
      ...config,
      values: { OPENCODE_PORT: "5000" },
    });
  });

  it("carries a module in the link and shows what runs as root", () => {
    const hash = encodeModule(jupyter);
    expect(hash.length).toBeLessThan(600);
    const decoded = decodeHash(`#${hash}`);
    expect(decoded.kind).toBe("module");
    if (decoded.kind !== "module") return;
    const result = review(decoded.source);
    expect(result.doc).toEqual(jupyter);
    expect(result.root).toEqual([
      { what: "setup hook (post-packages)", run: "echo root\necho twice" },
    ]);
    expect(result.secrets).toEqual(["JUPYTER_TOKEN"]);
    expect(unpack(hash.slice("module=".length))).toBe(toToml(jupyter));
  });

  it("loads its own files again", () => {
    const config = configWith(["claude-remote", "opencode"], {
      values: { CLAUDE_REMOTE_NAME: "nas", OPENCODE_SERVER_PASSWORD: "secret" },
      custom: [jupyter],
      service: "box",
      puid: "99",
      pgid: "100",
      tz: "Europe/Berlin",
      sshKeys: "~/.ssh",
      dataDir: "/mnt/box",
    });
    for (const inline of [false, true]) {
      const files = run({ ...config, inline }).output.files;
      const imported = importFiles(
        files.filter((f) => f.path !== ".env"),
        catalog,
      );
      expect(imported.notes).toEqual([]);
      expect(imported.config).toEqual({
        ...config,
        inline,
        values: { CLAUDE_REMOTE_NAME: "nas" },
      });
    }
  });

  it("asks for the module files fitout.toml enables", () => {
    const { output } = run(configWith([], { custom: [jupyter] }));
    const settings = output.files.filter(
      (f) => f.path === "config/fitout.toml",
    );
    expect(importFiles(settings, catalog).notes).toEqual([
      "fitout.toml enables jupyter, which is not in the catalog; load modules/jupyter.toml too.",
    ]);
  });
});
