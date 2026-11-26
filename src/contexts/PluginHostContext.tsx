// src/contexts/PluginHostContext.tsx
import type React from 'react';
import {
	type ReactNode,
	createContext,
	useEffect,
	useMemo,
	useState,
} from 'react';

import { pluginTypeRegistry } from '../plugin-host/PluginTypeRegistry';
import type {
	ContainerEngine,
	DockerInstallSource,
	InstallModeKind,
	Recipe,
	RecipeStatus,
	RegistryEntry,
} from '../plugin-host/types';
import { localCommand } from '../control/localClient';
import { registerChelysPlugins } from '../runtime/registerPlugins';

export interface MemberStatus {
	reference: string;
	recipeId: string;
	local: boolean;
	name: string;
	state: string;
}
interface PluginHostContextType {
	members: Record<string, MemberStatus[]>;
	recipes: Recipe[];
	statuses: Map<string, RecipeStatus>;
	isReady: boolean;
	install: (
		recipeId: string,
		mode: InstallModeKind,
		source?: DockerInstallSource,
	) => Promise<void>;
	cancelInstall: (recipeId: string) => Promise<void>;
	run: (recipeId: string) => Promise<void>;
	stop: (recipeId: string) => Promise<void>;
	save: (recipe: Recipe) => Promise<Recipe>;
	remove: (recipeId: string) => Promise<void>;
	uninstall: (recipeId: string) => Promise<void>;
	importRecipe: (type: string, raw: string) => Promise<Recipe>;
	registry: RegistryEntry[];
	refreshRegistry: () => Promise<void>;
	installFromRegistry: (
		entry: RegistryEntry,
		version?: string,
	) => Promise<Recipe>;
	updatesAvailable: Map<string, string>;
	setVariables: (
		recipeId: string,
		values: Record<string, string>,
	) => Promise<void>;
	getContainerEngineOverride: (recipeId: string) => ContainerEngine | null;
	setContainerEngineOverride: (
		recipeId: string,
		engine: ContainerEngine | null,
	) => Promise<void>;
}

export const PluginHostContext = createContext<PluginHostContextType>({
	recipes: [],
	members: {},
	statuses: new Map(),
	isReady: false,
	install: async (
		_recipeId: string,
		_mode: InstallModeKind,
		_source?: DockerInstallSource,
	) => {},
	cancelInstall: async () => {},
	run: async () => {},
	stop: async () => {},
	save: async () => {
		throw new Error('Not implemented');
	},
	remove: async () => {},
	uninstall: async () => {},
	importRecipe: async () => {
		throw new Error('Not implemented');
	},
	registry: [],
	refreshRegistry: async () => {},
	installFromRegistry: async () => {
		throw new Error('Not implemented');
	},
	updatesAvailable: new Map(),
	setVariables: async () => {},
	getContainerEngineOverride: () => null,
	setContainerEngineOverride: async () => {},
});

type RecipeSnapshot = {
	members: Record<string, MemberStatus[]>;
	recipes: Recipe[];
	statuses: Record<string, RecipeStatus>;
	engines: Record<string, ContainerEngine | null>;
};

/** One recipe model for the full desktop UI, CLI and remote control. */
export const PluginHostProvider: React.FC<{ children: ReactNode }> = ({
	children,
}) => {
	const [statuses, setStatuses] = useState<Map<string, RecipeStatus>>(
		new Map(),
	);
	const [members, setMembers] = useState<Record<string, MemberStatus[]>>({});
	const [recipes, setRecipes] = useState<Recipe[]>([]);
	const [registry, setRegistry] = useState<RegistryEntry[]>([]);
	const [engines, setEngines] = useState<
		Record<string, ContainerEngine | null>
	>({});
	const [isReady, setIsReady] = useState(false);

	const refresh = async () => {
		const snapshot = await localCommand<RecipeSnapshot>('recipes.snapshot');
		setRecipes(snapshot.recipes);
		setMembers(snapshot.members ?? {});
		setStatuses(new Map(Object.entries(snapshot.statuses)));
		setEngines(snapshot.engines);
		return snapshot.recipes;
	};
	const refreshRegistry = async () => {
		const entries = await localCommand<RegistryEntry[]>(
			'recipes.registry.refresh',
		);
		setRegistry(entries);
	};
	const updatesAvailable = useMemo(() => {
		const updates = new Map<string, string>();
		for (const recipe of recipes) {
			const found = registry.find((entry) => entry.id === recipe.id);
			if (
				found?.version &&
				recipe.version &&
				found.version !== recipe.version
			) {
				updates.set(recipe.id, found.version);
			}
		}
		return updates;
	}, [registry, recipes]);

	useEffect(() => {
		let alive = true;
		registerChelysPlugins(); // UI schema only; backend owns every recipe process and bridge.
		void refresh()
			.then(() => {
				if (alive) setIsReady(true);
			})
			.catch((error) => console.error('[Chelys] Cannot load recipes', error));
		void refreshRegistry().catch((error) =>
			console.warn('[Chelys] Registry unavailable', error),
		);
		const timer = setInterval(() => {
			if (alive)
				void refresh()
					.then(() => {
						if (alive) setIsReady(true);
					})
					.catch((error) =>
						console.warn('[Chelys] Could not refresh recipe status', error),
					);
		}, 2000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, []);

	const callAndRefresh = async (
		method: string,
		params: Record<string, unknown>,
	): Promise<void> => {
		try {
			await localCommand(method, params);
		} finally {
			await refresh().catch(() => undefined);
		}
	};
	const save = async (recipe: Recipe): Promise<Recipe> => {
		const saved = await localCommand<Recipe>('recipes.save', { recipe });
		await refresh();
		return saved;
	};
	const importRecipe = async (type: string, raw: string) => {
		const parser = pluginTypeRegistry.get(type)?.parseImport;
		if (!parser) throw new Error('This plugin type does not support import');
		return save(parser(raw));
	};
	const installFromRegistry = async (
		entry: RegistryEntry,
		version?: string,
	): Promise<Recipe> => {
		const saved = await localCommand<Recipe>('recipes.registry.add', {
			id: entry.id,
			version,
		});
		await refresh();
		return saved;
	};
	const setContainerEngineOverride = async (
		id: string,
		engine: ContainerEngine | null,
	) => {
		await localCommand('recipes.engine.set', { id, engine });
		setEngines((previous) => ({ ...previous, [id]: engine }));
	};
	return (
		<PluginHostContext.Provider
			value={{
				recipes,
				members,
				statuses,
				isReady,
				install: async (id, mode, source) => {
					try {
						await callAndRefresh('recipes.install', { id, mode, source });
					} catch (error) {
						const missing = String(error).includes(
							'Storage volume initialization cancelled',
						);
						const recipe = recipes.find((item) => item.id === id);
						if (!missing || recipe?.type !== 'storage' || mode !== 'docker')
							throw error;
						if (
							!window.confirm(
								'The storage recipe requires empty container volumes. Initialize them now? Existing data will not be deleted.',
							)
						)
							throw error;
						await callAndRefresh('recipes.install', {
							id,
							mode,
							source,
							initializeVolumes: true,
						});
					}
				},
				cancelInstall: (id) => callAndRefresh('recipes.cancelInstall', { id }),
				run: (id) => callAndRefresh('recipes.run', { id }),
				stop: (id) => callAndRefresh('recipes.stop', { id }),
				save,
				remove: (id) => callAndRefresh('recipes.remove', { id }),
				uninstall: (id) => callAndRefresh('recipes.uninstall', { id }),
				importRecipe,
				registry,
				refreshRegistry,
				installFromRegistry,
				updatesAvailable,
				setVariables: (id, values) =>
					callAndRefresh('recipes.variables.set', { id, values }),
				getContainerEngineOverride: (id) => engines[id] ?? null,
				setContainerEngineOverride,
			}}
		>
			{children}
		</PluginHostContext.Provider>
	);
};
