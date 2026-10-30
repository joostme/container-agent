export interface EnvVar {
	name: string;
	description: string;
	default: string;
	required: boolean;
	secret: boolean;
	port: 'http' | 'tcp' | null;
}

export interface Module {
	name: string;
	/** Services run a process, apps only install and set up. */
	kind: 'service' | 'app';
	description: string;
	requires: string[];
	after: string[];
	arch: Arch[] | null;
	nextSteps: string[];
	env: EnvVar[];
	daemons: string[];
	tools: string[];
	packages: string[];
	commands: string[];
}

export interface Registry {
	image: string;
	version: string;
	modules: Module[];
}

export type Arch = 'amd64' | 'arm64';

export interface Tool {
	name: string;
	/** Empty means latest. */
	version: string;
}

export interface CustomVar {
	name: string;
	default: string;
	description: string;
	secret: boolean;
	required: boolean;
	port: '' | 'http' | 'tcp';
}

export interface CustomDaemon {
	name: string;
	run: string;
	/** TCP port that is open once the process is ready; empty for none. */
	readyPort: string;
}

/** A module defined in the configurator and shipped inside compose.yaml. */
export interface CustomModule {
	name: string;
	description: string;
	requires: string[];
	tools: Tool[];
	/** apt packages, separated by spaces. */
	packages: string;
	/** Shell commands run as root after the apt packages. */
	rootSetup: string;
	/** Shell commands run as the agent user after the tools. */
	userSetup: string;
	env: CustomVar[];
	daemons: CustomDaemon[];
	/** One step per line. */
	nextSteps: string;
}

export interface Config {
	/** Modules picked by the user; the ones they require come along. */
	modules: string[];
	/** Values of module variables, secrets included. */
	values: Record<string, string>;
	/** Modules defined here; always enabled. */
	custom: CustomModule[];
	/** Compose service, container and host name. */
	service: string;
	imageTag: string;
	puid: string;
	pgid: string;
	tz: string;
	agentUser: string;
	dataDir: string;
	/** Host directory with SSH keys, mounted read-only; empty for none. */
	sshKeys: string;
	autoUpdate: boolean;
}
