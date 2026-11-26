// src/components/plugin-host/RecipeVariables.tsx
import type React from 'react';
import { useId, useState } from 'react';

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
	const [revealed, setRevealed] = useState<Set<string>>(new Set());
	const [containerEngine, setContainerEngine] = useState<ContainerEngine | ''>(
		() => getContainerEngineOverride(recipe.id) ?? '',
	);
	const fieldPrefix = useId();
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
		await setContainerEngineOverride(recipe.id, containerEngine || null);
		onDone();
	};

	return (
		<div className='recipe-variables'>
			{hasContainerMode && (
				<div className='form-group ui-field'>
					<label htmlFor={`${fieldPrefix}-engine`}>
						{t('Container engine')}
					</label>
					<select
						id={`${fieldPrefix}-engine`}
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
						<option value='docker'>{t('Docker')}</option>
						<option value='podman'>{t('Podman')}</option>
					</select>
					<small>{t('Container engine used to install this recipe.')}</small>
				</div>
			)}

			{(recipe.variables ?? []).map((variable: RecipeVariable) => {
				const portLocked = traefikEnabled && isPortVariable(variable.key);
				return (
					<div key={variable.key} className='form-group ui-field'>
						<label htmlFor={`${fieldPrefix}-${variable.key}`}>
							{t(variable.label)}
						</label>
						{variable.kind === 'select' ? (
							<select
								id={`${fieldPrefix}-${variable.key}`}
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
								id={`${fieldPrefix}-${variable.key}`}
								type='checkbox'
								checked={values[variable.key] === 'true'}
								onChange={(e) =>
									update(variable.key, e.target.checked ? 'true' : 'false')
								}
							/>
						) : variable.kind === 'secret' ? (
							<div className='recipe-secret-field'>
								<input
									id={`${fieldPrefix}-${variable.key}`}
									type={revealed.has(variable.key) ? 'text' : 'password'}
									dir='ltr'
									value={values[variable.key] ?? ''}
									onChange={(e) => update(variable.key, e.target.value)}
									autoComplete='off'
									spellCheck={false}
								/>
								<button
									type='button'
									className='button'
									onClick={() =>
										setRevealed((prev) => {
											const next = new Set(prev);
											if (next.has(variable.key)) next.delete(variable.key);
											else next.add(variable.key);
											return next;
										})
									}
								>
									{revealed.has(variable.key) ? t('Hide') : t('Show')}
								</button>
							</div>
						) : (
							<input
								id={`${fieldPrefix}-${variable.key}`}
								type={variable.kind === 'number' ? 'number' : 'text'}
								dir={variable.kind === 'number' ? 'ltr' : 'auto'}
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
				<div className='form-group ui-field'>
					<label htmlFor={`${fieldPrefix}-traefik`}>
						{t('Traefik endpoint')}
					</label>
					<input
						id={`${fieldPrefix}-traefik`}
						type='text'
						dir='ltr'
						value={traefikUrl}
						readOnly
					/>
					<small>
						{t(
							'Traefik routing is on. The service port is managed by Traefik and ignored here.',
						)}
					</small>
				</div>
			)}

			<div
				className='form-actions ui-actions'
				data-variant='form'
				data-align='end'
			>
				<button type='button' className='button' onClick={onDone}>
					{t('Cancel')}
				</button>
				<button type='button' className='button primary' onClick={handleSave}>
					{t('Save settings')}
				</button>
			</div>
		</div>
	);
};

export default RecipeVariables;
