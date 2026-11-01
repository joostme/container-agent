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
	homepage: string | null;
	tags: string[];
	requires: string[];
	nextSteps: string[];
	env: EnvVar[];
	/** Tasks; each is a command in the container. */
	commands: string[];
	daemons: string[];
	/** What runs as root: hooks and daemons, with their commands. */
	root: { what: string; run: string }[];
	doc: Doc;
}

export interface Config {
	/** Image tag. */
	image: string;
	/** Catalog URL for fitout.toml; empty for the official one. */
	catalog: string;
	/** Catalog modules the user picked. */
	modules: string[];
	/** Custom modules, always enabled and written to modules/<name>.toml. */
	custom: Doc[];
	/** Values of module variables, secrets included (those go to .env). */
	values: Record<string, string>;
	puid: string;
	pgid: string;
	/** Compose service and host name. */
	service: string;
	tz: string;
	dataDir: string;
	/** Host directory with SSH keys for the ssh module, mounted read-only; empty for none. */
	sshKeys: string;
	/** fitout.toml and the modules inside compose.yaml instead of a config folder. */
	inline: boolean;
}
