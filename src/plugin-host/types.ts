// src/plugin-host/types.ts
export interface CommandSpec {
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
}

export interface InstallStep {
	label: string;
	command: string;
	args: string[];
}

export type PlatformId = string;

export interface PlatformPipeline {
	installSteps?: InstallStep[];
	uninstallSteps?: InstallStep[];
	runCommand?: { command: string; args: string[] };
}

export type InstallModeKind = 'system' | 'docker' | 'connect';
export type ContainerEngine = 'docker' | 'podman';

export interface SystemMode {
	kind: 'system';
	installSteps: InstallStep[];
	uninstallSteps?: InstallStep[];
	runCommand: { command: string; args: string[] };
	platforms?: Record<PlatformId, PlatformPipeline>;
}

export interface DockerPlatformOverride {
	runArgs?: string[];
	command?: string[];
}

export interface DockerMode {
	kind: 'docker';
	image: string;
	buildSteps: InstallStep[];
	runArgs: string[];
	command?: string[];
	dockerfile?: string;
	dockerfileUrl?: string;
	platforms?: Record<PlatformId, DockerPlatformOverride>;
}

export interface ConnectMode {
	kind: 'connect';
}

export type InstallMode = SystemMode | DockerMode | ConnectMode;

export type DockerInstallSource = 'build' | 'registry';

export type VariableKind = 'text' | 'number' | 'boolean' | 'select';

export interface RecipeVariable {
	key: string;
	label: string;
	kind: VariableKind;
	default?: string;
	help?: string;
	options?: string[];
}

export type RecipeSource = 'seed' | 'registry' | 'user';

export interface Recipe {
	id: string;
	type: string;
	name: string;
	version?: string;
	icon?: string;
	iconUrl?: string;
	backend?: string;
	notes?: string;
	env: Record<string, string>;
	cwd?: string;
	modes: InstallMode[];
	selectedMode?: InstallModeKind;
	typeConfig: Record<string, unknown>;
	extraFiles?: string[];
	sourceUrl?: string;
	variables?: RecipeVariable[];
	variableValues?: Record<string, string>;
	source?: RecipeSource;
}

export interface RecipeVersion {
	version: string;
	manifestUrl: string;
}

export interface RegistryEntry {
	id: string;
	type: string;
	name: string;
	icon?: string;
	iconUrl?: string;
	version?: string;
	description?: string;
	tags?: string[];
	manifestUrl: string;
	versions?: RecipeVersion[];
}

export type RecipeRuntimeState =
	| 'not-installed'
	| 'installing'
	| 'installed'
	| 'starting'
	| 'running'
	| 'stopping'
	| 'stopped'
	| 'error';

export interface RecipeStatus {
	recipeId: string;
	state: RecipeRuntimeState;
	mode: InstallModeKind | null;
	lastError: string | null;
	logTail: string[];
}

export type FieldKind = 'text' | 'textarea' | 'number' | 'boolean' | 'list';

export interface FieldSchema {
	key: string;
	label: string;
	kind: FieldKind;
	help?: string;
	placeholder?: string;
}

export interface PluginTypeDefinition {
	type: string;
	exclusive?: boolean;
	label: string;
	icon?: string;
	seeds: Recipe[];
	formSchema: FieldSchema[];
	parseImport?: (raw: string) => Recipe;
	toConfigBlock?: (recipe: Recipe) => Record<string, unknown>;
	onStart?: (recipe: Recipe) => void;
	onStop?: (recipe: Recipe) => void;
}

export const modeLabel = (kind: InstallModeKind): string =>
	kind === 'system'
		? 'Install on system'
		: kind === 'docker'
			? 'Container'
			: 'Connect to existing';

export const findMode = <K extends InstallModeKind>(
	recipe: Recipe,
	kind: K,
): Extract<InstallMode, { kind: K }> | undefined =>
	recipe.modes.find((m) => m.kind === kind) as
		| Extract<InstallMode, { kind: K }>
		| undefined;
