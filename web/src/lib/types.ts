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

export interface Config {
	/** Modules picked by the user; the ones they require come along. */
	modules: string[];
	/** Values of module variables, secrets included. */
	values: Record<string, string>;
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
	arch: Arch | 'any';
	exposure: 'ports' | 'traefik';
	traefik: {
		network: string;
		entrypoint: string;
		certResolver: string;
		/** Host name per http port variable. */
		hosts: Record<string, string>;
	};
}
