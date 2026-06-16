// src/contexts/PluginHostContext.tsx
import type React from 'react';
import { type ReactNode, createContext, useEffect, useState } from 'react';

import { recipeManager } from '../plugin-host/RecipeManager';
import { recipeRegistry } from '../plugin-host/RecipeRegistry';
import { pluginTypeRegistry } from '../plugin-host/PluginTypeRegistry';
import type {
	InstallModeKind,
	Recipe,
	RecipeStatus,
	RegistryEntry,
} from '../plugin-host/types';
import { registerLspPlugin } from '../plugins/lsp';

registerLspPlugin();

interface PluginHostContextType {
	recipes: Recipe[];
	statuses: Map<string, RecipeStatus>;
	isReady: boolean;
	install: (recipeId: string, mode: InstallModeKind) => Promise<void>;
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
}

export const PluginHostContext = createContext<PluginHostContextType>({
	recipes: [],
	statuses: new Map(),
	isReady: false,
	install: async (_recipeId: string, _mode: InstallModeKind) => { },
	run: async () => { },
	stop: async () => { },
	save: async () => {
		throw new Error('Not implemented');
	},
	remove: async () => { },
	uninstall: async () => { },
	importRecipe: async () => {
		throw new Error('Not implemented');
	},
	registry: [],
	refreshRegistry: async () => { },
	installFromRegistry: async () => {
		throw new Error('Not implemented');
	},
	updatesAvailable: new Map(),
	setVariables: async () => { },
});

export const PluginHostProvider: React.FC<{ children: ReactNode }> = ({
	children,
}) => {
	const [statuses, setStatuses] = useState<Map<string, RecipeStatus>>(new Map());
	const [recipes, setRecipes] = useState<Recipe[]>([]);
	const [registry, setRegistry] = useState<RegistryEntry[]>([]);
	const [updatesAvailable, setUpdatesAvailable] = useState<Map<string, string>>(
		new Map(),
	);
	const [isReady, setIsReady] = useState(false);

	useEffect(() => {
		let unsubscribe: (() => void) | undefined;
		(async () => {
			await recipeManager.initialize();
			setRecipes(recipeManager.listRecipes());
			unsubscribe = recipeManager.subscribe((next) => setStatuses(new Map(next)));
			setIsReady(true);
			try {
				const entries = await recipeRegistry.list(false);
				setRegistry(entries);
				setUpdatesAvailable(recipeManager.checkForUpdates(entries));
			} catch {
				/* registry unavailable on start */
			}
		})();
		return () => unsubscribe?.();
	}, []);

	const refresh = () => setRecipes(recipeManager.listRecipes());

	const save = async (recipe: Recipe) => {
		const saved = await recipeManager.save(recipe);
		refresh();
		return saved;
	};

	const remove = async (recipeId: string) => {
		await recipeManager.remove(recipeId);
		refresh();
	};

	const uninstall = async (recipeId: string) => {
		await recipeManager.uninstall(recipeId);
		refresh();
	};

	const importRecipe = async (type: string, raw: string) => {
		const parser = pluginTypeRegistry.get(type)?.parseImport;
		if (!parser) throw new Error('This plugin type does not support import');
		return save(parser(raw));
	};

	const refreshRegistry = async () => {
		const entries = await recipeRegistry.list(false);
		setRegistry(entries);
		setUpdatesAvailable(recipeManager.checkForUpdates(entries));
	};

	const installFromRegistry = async (entry: RegistryEntry, version?: string) => {
		const saved = await recipeManager.installFromRegistry(entry, version);
		refresh();
		setUpdatesAvailable(recipeManager.checkForUpdates(registry));
		return saved;
	};

	const setVariables = async (
		recipeId: string,
		values: Record<string, string>,
	) => {
		await recipeManager.setVariables(recipeId, values);
		refresh();
	};

	return (
		<PluginHostContext.Provider
			value={{
				recipes,
				statuses,
				isReady,
				install: recipeManager.install.bind(recipeManager),
				run: recipeManager.run.bind(recipeManager),
				stop: recipeManager.stop.bind(recipeManager),
				save,
				remove,
				uninstall,
				importRecipe,
				registry,
				refreshRegistry,
				installFromRegistry,
				updatesAvailable,
				setVariables,
			}}
		>
			{children}
		</PluginHostContext.Provider>
	);
};
