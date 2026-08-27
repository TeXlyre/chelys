// src/plugins/infrastructure/index.ts
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import type { Recipe } from '../../plugin-host/types';

export const INFRASTRUCTURE_TYPE = 'infrastructure';

const TRAEFIK_VERSION = 'v3.7.8';
const TRAEFIK_BASE = `https://github.com/traefik/traefik/releases/download/${TRAEFIK_VERSION}`;

const traefikArgs = [
	'--entrypoints.web.address=:${httpPort}',
	'--entrypoints.traefik.address=:${dashboardPort}',
	'--api.dashboard=true',
	'--api.insecure=true',
	'--providers.http.endpoint=${CHELYS_ROUTE_ENDPOINT}',
	'--providers.http.pollInterval=2s',
];

const publishedPorts = [
	'-p',
	'${httpPort}:${httpPort}',
	'-p',
	'${dashboardPort}:${dashboardPort}',
];

const unixInstall = (asset: string) => [
	{
		label: 'Download Traefik',
		command: 'curl',
		args: [
			'-fL',
			'-o',
			'${CHELYS_DATA}/traefik.tar.gz',
			`${TRAEFIK_BASE}/${asset}`,
		],
	},
	{
		label: 'Extract Traefik',
		command: 'tar',
		args: [
			'-xzf',
			'${CHELYS_DATA}/traefik.tar.gz',
			'-C',
			'${CHELYS_DATA}',
			'traefik',
		],
	},
];

const unixUninstall = [
	{
		label: 'Remove Traefik',
		command: 'rm',
		args: ['-f', '${CHELYS_DATA}/traefik', '${CHELYS_DATA}/traefik.tar.gz'],
	},
];

const traefikRecipe: Recipe = {
	id: 'traefik',
	type: INFRASTRUCTURE_TYPE,
	name: 'Traefik',
	version: TRAEFIK_VERSION.replace(/^v/, ''),
	notes:
		'Reverse proxy that routes TeXlyre services through a single entrypoint. While "Route services through Traefik" is enabled in settings, Chelys serves the routing table to Traefik over HTTP and Traefik polls it. System mode downloads the Traefik binary into the Chelys data directory. Docker mode uses host networking on Linux and published ports on Windows and macOS, where the Traefik backend host must be set to host.docker.internal; note that services installed in system mode listen on loopback and stay unreachable from a containerised Traefik.',
	env: {},
	variables: [
		{
			key: 'httpPort',
			label: 'HTTP port',
			kind: 'number',
			default: '8000',
			help: 'Entrypoint port Traefik listens on. Ports below 1024 require elevated privileges.',
		},
		{
			key: 'dashboardPort',
			label: 'Dashboard port',
			kind: 'number',
			default: '8080',
			help: 'Traefik dashboard/API port.',
		},
	],
	modes: [
		{
			kind: 'system',
			installSteps: unixInstall(
				`traefik_${TRAEFIK_VERSION}_linux_amd64.tar.gz`,
			),
			runCommand: {
				command: '${CHELYS_DATA}/traefik',
				args: traefikArgs,
			},
			uninstallSteps: unixUninstall,
			platforms: {
				macos: {
					installSteps: unixInstall(
						`traefik_${TRAEFIK_VERSION}_darwin_arm64.tar.gz`,
					),
				},
				windows: {
					installSteps: [
						{
							label: 'Download Traefik',
							command: 'curl',
							args: [
								'-fL',
								'-o',
								'${CHELYS_DATA}/traefik.zip',
								`${TRAEFIK_BASE}/traefik_${TRAEFIK_VERSION}_windows_amd64.zip`,
							],
						},
						{
							label: 'Extract Traefik',
							command: 'tar',
							args: [
								'-xf',
								'${CHELYS_DATA}/traefik.zip',
								'-C',
								'${CHELYS_DATA}',
								'traefik.exe',
							],
						},
					],
					runCommand: {
						command: '${CHELYS_DATA}/traefik.exe',
						args: traefikArgs,
					},
					uninstallSteps: [
						{
							label: 'Remove Traefik',
							command: 'cmd',
							args: [
								'/c',
								'del',
								'/q',
								'${CHELYS_DATA}\\traefik.exe',
								'${CHELYS_DATA}\\traefik.zip',
							],
						},
					],
				},
			},
		},
		{
			kind: 'docker',
			image: `traefik:${TRAEFIK_VERSION.replace(/^v/, '')}`,
			buildSteps: [],
			runArgs: ['--network', 'host'],
			command: traefikArgs,
			platforms: {
				windows: { runArgs: publishedPorts },
				macos: { runArgs: publishedPorts },
			},
		},
		{ kind: 'connect' },
	],
	typeConfig: {},
};

export function registerInfrastructurePlugin(): void {
	pluginTypeRegistry.register({
		type: INFRASTRUCTURE_TYPE,
		exclusive: true,
		label: 'Infrastructure',
		icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
		seeds: [traefikRecipe],
		formSchema: [
			{ key: 'name', label: 'Name', kind: 'text', placeholder: 'Traefik' },
		],
	});
}
