import { stringify } from 'yaml';
import { resolveModules, type Resolution } from './resolve';
import type { Config, EnvVar, Module, Registry } from './types';

export const SETTINGS_KEY = 'x-container-agent';

export interface Port {
	module: string;
	variable: string;
	protocol: 'http' | 'tcp';
	port: string;
}

export interface Step {
	text: string;
	/** Parts of the text: plain text and commands to run on the Docker host. */
	parts: { text: string; command: boolean }[];
}

export interface Output {
	resolution: Resolution;
	compose: string;
	env: string;
	steps: Step[];
	warnings: string[];
	ports: Port[];
}

export function defaultConfig(registry: Registry): Config {
	return {
		modules: [],
		values: {},
		service: 'agent',
		imageTag: registry.version,
		puid: '1000',
		pgid: '1000',
		tz: '',
		agentUser: 'agent',
		dataDir: './data',
		sshKeys: '',
		autoUpdate: true,
		arch: 'any',
		exposure: 'ports',
		traefik: { network: 'proxy', entrypoint: 'websecure', certResolver: 'letsencrypt', hosts: {} }
	};
}

/** The value a module variable gets in the container. */
export function effectiveValue(config: Config, variable: EnvVar): string {
	return config.values[variable.name] || variable.default;
}

export function portsOf(config: Config, modules: Module[]): Port[] {
	return modules.flatMap((module) =>
		module.env
			.filter((variable) => variable.port)
			.map((variable) => ({
				module: module.name,
				variable: variable.name,
				protocol: variable.port as 'http' | 'tcp',
				port: effectiveValue(config, variable)
			}))
	);
}

/** Router and service name for Traefik, unique per port variable. */
export function routerName(config: Config, port: Port, ports: Port[]): string {
	const sameModule = ports.filter((p) => p.module === port.module && p.protocol === 'http');
	const suffix = sameModule.length > 1 ? `-${port.variable.toLowerCase().replaceAll('_', '-')}` : '';
	return `${config.service}-${port.module}${suffix}`;
}

function environment(config: Config, modules: Module[]): Record<string, string> {
	const env: Record<string, string> = {
		PUID: config.puid,
		PGID: config.pgid
	};
	if (config.tz) env.TZ = config.tz;
	if (config.agentUser && config.agentUser !== 'agent') env.AGENT_USER = config.agentUser;
	if (!config.autoUpdate) env.AUTO_UPDATE = 'false';
	env.AGENT_MODULES = config.modules.join(',');
	for (const module of modules) {
		for (const variable of module.env) {
			const value = config.values[variable.name] ?? '';
			if (variable.secret) {
				// value lives in .env
				env[variable.name] = `\${${variable.name}}`;
			} else if (value && value !== variable.default) {
				env[variable.name] = value;
			}
		}
	}
	return env;
}

function envFile(modules: Module[], config: Config): string {
	const secrets = modules.flatMap((m) => m.env.filter((v) => v.secret));
	if (secrets.length === 0) return '# No secrets needed for these modules\n';
	const lines = ['# Secrets for compose.yaml; keep this file next to it and out of git'];
	for (const variable of secrets) {
		lines.push('');
		if (variable.description) lines.push(`# ${variable.description}`);
		lines.push(`${variable.name}=${config.values[variable.name] ?? ''}`);
	}
	return `${lines.join('\n')}\n`;
}

function traefikLabels(config: Config, ports: Port[]): Record<string, string> {
	const labels: Record<string, string> = { 'traefik.enable': 'true' };
	for (const port of ports.filter((p) => p.protocol === 'http')) {
		const name = routerName(config, port, ports);
		const host = config.traefik.hosts[port.variable] || `${name}.example.com`;
		labels[`traefik.http.routers.${name}.rule`] = `Host(\`${host}\`)`;
		labels[`traefik.http.routers.${name}.entrypoints`] = config.traefik.entrypoint;
		if (config.traefik.certResolver) {
			labels[`traefik.http.routers.${name}.tls.certresolver`] = config.traefik.certResolver;
		}
		labels[`traefik.http.routers.${name}.service`] = name;
		labels[`traefik.http.services.${name}.loadbalancer.server.port`] = port.port;
	}
	return labels;
}

/**
 * Settings stored in compose.yaml and the share link, so the configurator can
 * load them again: only what differs from the defaults, never secrets.
 */
export function storedSettings(config: Config, registry: Registry): Partial<Config> {
	const secretNames = new Set(
		registry.modules.flatMap((m) => m.env.filter((v) => v.secret).map((v) => v.name))
	);
	const values = Object.fromEntries(
		Object.entries(config.values).filter(([name, value]) => value && !secretNames.has(name))
	);
	const defaults = defaultConfig(registry);
	const stored: Record<string, unknown> = { modules: config.modules };
	if (Object.keys(values).length) stored.values = values;
	for (const key of Object.keys(defaults) as (keyof Config)[]) {
		if (key === 'modules' || key === 'values') continue;
		if (JSON.stringify(config[key]) !== JSON.stringify(defaults[key])) stored[key] = config[key];
	}
	return stored as Partial<Config>;
}

function compose(config: Config, registry: Registry, modules: Module[], ports: Port[]): string {
	const home = `/home/${config.agentUser || 'agent'}`;
	const volumes = [`${config.dataDir}/home:${home}`, `${config.dataDir}/repos:/repos`];
	if (config.sshKeys) volumes.push(`${config.sshKeys}:${home}/.ssh-keys:ro`);

	const published = config.exposure === 'traefik' ? ports.filter((p) => p.protocol === 'tcp') : ports;
	const service: Record<string, unknown> = {
		image: `${registry.image}:${config.imageTag || registry.version}`,
		container_name: config.service,
		hostname: config.service,
		restart: 'unless-stopped',
		environment: environment(config, modules),
		volumes
	};
	if (published.length) service.ports = published.map((p) => `${p.port}:${p.port}`);

	const doc: Record<string, unknown> = { services: { [config.service]: service } };
	if (config.exposure === 'traefik' && ports.some((p) => p.protocol === 'http')) {
		service.labels = traefikLabels(config, ports);
		service.networks = [config.traefik.network];
		doc.networks = { [config.traefik.network]: { external: true } };
	}
	doc[SETTINGS_KEY] = storedSettings(config, registry);

	const header = [
		'# Generated by the container-agent configurator. Load this file there again to change it.',
		'# Start: docker compose up -d   Logs: docker compose logs -f',
		''
	].join('\n');
	return header + stringify(doc, { lineWidth: 0 });
}

function steps(config: Config, modules: Module[]): Step[] {
	const exec = `docker compose exec ${config.service} `;
	const toStep = (text: string): Step => ({
		text,
		parts: text
			.split(/(`[^`]+`)/)
			.filter(Boolean)
			.map((part) =>
				part.startsWith('`') ? { text: exec + part.slice(1, -1), command: true } : { text: part, command: false }
			)
	});
	return [
		{
			text: 'Start the container: `docker compose up -d`. The first start installs all tools and takes a few minutes.',
			parts: [
				{ text: 'Start the container: ', command: false },
				{ text: 'docker compose up -d', command: true },
				{ text: '. The first start installs all tools and takes a few minutes.', command: false }
			]
		},
		...modules.flatMap((m) => m.nextSteps.map(toStep))
	];
}

function warnings(config: Config, resolution: Resolution, ports: Port[]): string[] {
	const result: string[] = [];
	if (config.modules.length === 0) result.push('No module selected.');
	for (const name of resolution.unknown) result.push(`Unknown module "${name}" in this image version.`);
	if (resolution.cycle) result.push(`Modules depend on each other in a cycle at "${resolution.cycle}".`);
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(config.service)) {
		result.push('The service name may only contain letters, digits, dots, dashes and underscores.');
	}
	for (const module of resolution.order) {
		if (config.arch !== 'any' && module.arch && !module.arch.includes(config.arch)) {
			result.push(`${module.name} does not run on ${config.arch}.`);
		}
		for (const variable of module.env) {
			if (variable.required && !effectiveValue(config, variable)) {
				result.push(`${variable.name} is required by ${module.name}; the container will not start without it.`);
			}
		}
	}
	const seen = new Map<string, string>();
	for (const port of ports) {
		const other = seen.get(port.port);
		if (other) result.push(`Port ${port.port} is used by ${other} and ${port.variable}.`);
		else seen.set(port.port, port.variable);
		if (!/^\d+$/.test(port.port)) result.push(`${port.variable} must be a port number.`);
	}
	if (config.exposure === 'traefik') {
		for (const port of ports.filter((p) => p.protocol === 'http')) {
			if (!config.traefik.hosts[port.variable]) {
				result.push(`Set a host name for ${port.module}; the labels use a placeholder.`);
			}
		}
	}
	const codeServer = resolution.order.find((m) => m.name === 'code-server');
	if (codeServer && !config.values.CODE_SERVER_PASSWORD) {
		result.push('code-server runs without a password; anyone who reaches the port can use the container.');
	}
	return result;
}

export function generate(config: Config, registry: Registry): Output {
	const resolution = resolveModules(registry, config.modules);
	const ports = portsOf(config, resolution.order);
	return {
		resolution,
		compose: compose(config, registry, resolution.order, ports),
		env: envFile(resolution.order, config),
		steps: steps(config, resolution.order),
		warnings: warnings(config, resolution, ports),
		ports
	};
}
