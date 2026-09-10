// src/components/plugin-host/RecipeVariables.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { effectiveValues } from '../../plugin-host/variableResolution';
import { rewriteTransportUrl } from '../../plugin-host/traefikRouting';
import { getStoredSetting } from '../../config';
import {
	findMode,
	type ContainerEngine,
	type Recipe,
	type RecipeVariable,
} from '../../plugin-host/types';

interface RecipeVariablesProps {
	recipe: Recipe;
	onDone: () => void;
}

const isPortVariable = (key: string): boolean => /port$/i.test(key);

const RecipeVariables: React.FC<RecipeVariablesProps> = ({
	recipe,
	onDone,
}) => {
	const {
		setVariables,
		getContainerEngineOverride,
		setContainerEngineOverride,
	} = usePluginHost();
	const [values, setValues] = useState<Record<string, string>>(() =>
		effectiveValues(recipe),
	);
	const [containerEngine, setContainerEngine] = useState<ContainerEngine | ''>(
		() => getContainerEngineOverride(recipe.id) ?? '',
	);
	const hasContainerMode = !!findMode(recipe, 'docker');

	if (
		!hasContainerMode &&
		(!recipe.variables || recipe.variables.length === 0)
	) {
		return null;
	}

	const traefikEnabled = getStoredSetting<boolean>('traefikEnabled');
	const defaultContainerEngine =
		getStoredSetting<ContainerEngine>('defaultContainerEngine') === 'podman'
			? 'podman'
			: 'docker';
	const typeConfig = recipe.typeConfig as {
		transportUrl?: unknown;
		configId?: unknown;
	};
	const traefikUrl =
		typeof typeConfig.transportUrl === 'string'
			? rewriteTransportUrl({
					transportUrl: typeConfig.transportUrl,
					configId: typeConfig.configId,
				})
			: undefined;

	const update = (key: string, value: string) =>
		setValues((prev) => ({ ...prev, [key]: value }));

	const handleSave = async () => {
		if (recipe.variables?.length) await setVariables(recipe.id, values);
		setContainerEngineOverride(recipe.id, containerEngine || null);
		onDone();
	};

	return (
		<div className='recipe-variables'>
			{hasContainerMode && (
				<div className='form-group'>
					<label>{t('Container engine')}</label>
					<select
						value={containerEngine}
						onChange={(e) =>
							setContainerEngine(e.target.value as ContainerEngine | '')
						}
					>
						<option value=''>
							{t('Default ({engine})', {
								engine:
									defaultContainerEngine === 'podman' ? 'Podman' : 'Docker',
							})}
						</option>
						<option value='docker'>Docker</option>
						<option value='podman'>Podman</option>
					</select>
					<small>
						{t('Overrides the default container engine on the next install.')}
					</small>
				</div>
			)}

			{(recipe.variables ?? []).map((variable: RecipeVariable) => {
				const portLocked = traefikEnabled && isPortVariable(variable.key);
				return (
					<div key={variable.key} className='form-group'>
						<label>{t(variable.label)}</label>
						{variable.kind === 'select' ? (
							<select
								value={values[variable.key] ?? ''}
								onChange={(e) => update(variable.key, e.target.value)}
							>
								{(variable.options ?? []).map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						) : variable.kind === 'boolean' ? (
							<input
								type='checkbox'
								checked={values[variable.key] === 'true'}
								onChange={(e) =>
									update(variable.key, e.target.checked ? 'true' : 'false')
								}
							/>
						) : (
							<input
								type={variable.kind === 'number' ? 'number' : 'text'}
								value={values[variable.key] ?? ''}
								onChange={(e) => update(variable.key, e.target.value)}
								disabled={portLocked}
							/>
						)}
						{portLocked ? (
							<small>{t('Managed by Traefik while routing is enabled.')}</small>
						) : (
							variable.help && <small>{t(variable.help)}</small>
						)}
					</div>
				);
			})}

			{traefikEnabled && traefikUrl && (
				<div className='form-group'>
					<label>{t('Traefik endpoint')}</label>
					<input type='text' value={traefikUrl} readOnly />
					<small>
						{t(
							'Traefik routing is on. The service port is managed by Traefik and ignored here.',
						)}
					</small>
				</div>
			)}

			<div className='form-actions'>
				<button className='button' onClick={onDone}>
					{t('Cancel')}
				</button>
				<button className='button primary' onClick={handleSave}>
					{t('Save settings')}
				</button>
			</div>
		</div>
	);
};

export default RecipeVariables;
