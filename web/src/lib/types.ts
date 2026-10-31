/** A parsed module file (TOML), as it is: unknown keys stay. */
export type Doc = Record<string, unknown>;

export const VAR_TYPES = ['string', 'secret', 'port', 'bool', 'choice', 'path'] as const;
export type VarType = (typeof VAR_TYPES)[number];

export interface EnvVar {
	name: string;
	type: VarType;
	default: string;
	required: boolean;
	choices: string[];
	protocol: 'http' | 'tcp' | null;
	description: string;
}

/** What the configurator needs to know about a module, read from its file. */
export interface Module {
	name: string;
	/** Services run a process, apps only install and set up. */
	kind: 'service' | 'app';
	description: string;
	version: string;
	format: number | null;
	tags: string[];
	requires: string[];
	after: string[];
	arch: string[] | null;
	nextSteps: string[];
	env: EnvVar[];
	/** Tasks; each is a command in the container. */
	commands: string[];
	daemons: string[];
	/** What runs as root: hooks and daemons, with their commands. */
	root: { what: string; run: string }[];
	doc: Doc;
}

export interface CatalogVersion {
	format: number;
	sha256: string;
	date: string;
}

export interface CatalogEntry {
	description: string;
	kind: 'service' | 'app';
	tags: string[];
	author: string | null;
	homepage: string | null;
	requires: string[];
	versions: Record<string, CatalogVersion>;
}

export interface CatalogIndex {
	format: number;
	modules: Record<string, CatalogEntry>;
}

/** An image version and the module formats its entrypoint reads. */
export interface Engine {
	image: string;
	formats: number[];
}

export interface Config {
	/** Image tag. */
	image: string;
	/** Catalog URL for agent.toml; empty for the official one. */
	catalog: string;
	/** Catalog modules the user picked: name -> version or "latest". */
	modules: Record<string, string>;
	/** Versions of modules enabled only because others require them. */
	pins: Record<string, string>;
	/** Custom modules, enabled as "local" and written to modules/<name>.toml. */
	custom: Doc[];
	/** Values of module variables, secrets included (those go to .env). */
	values: Record<string, string>;
	puid: string;
	pgid: string;
	workspace: string;
	autoUpdate: boolean;
	/** Compose service and host name. */
	service: string;
	tz: string;
	dataDir: string;
	/** Host directory with SSH keys, mounted read-only; empty for none. */
	sshKeys: string;
	/** agent.toml and the modules inside compose.yaml instead of a config folder. */
	inline: boolean;
}
