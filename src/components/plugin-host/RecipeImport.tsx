// src/components/plugin-host/RecipeImport.tsx
import type React from 'react';
import { useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

import { t } from '@/i18n';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { loadRecipeFromDirectory } from '../../plugin-host/recipeDirectory';
import type { Recipe } from '../../plugin-host/types';
import { FileIcon, FolderIcon, UploadIcon, UrlIcon } from '../common/Icons';

interface RecipeImportProps {
	category?: string;
	onImported: (recipe: Recipe) => void;
	onCancel: () => void;
}

type ImportSource = 'url' | 'json';

const looksLikeRecipe = (value: unknown): value is Recipe =>
	!!value &&
	typeof value === 'object' &&
	Array.isArray((value as Recipe).modes) &&
	typeof (value as Recipe).typeConfig === 'object';

const RecipeImport: React.FC<RecipeImportProps> = ({
	category,
	onImported,
	onCancel,
}) => {
	const types = pluginTypeRegistry.list();
	const dropRef = useRef<HTMLDivElement>(null);
	const [type, setType] = useState(category ?? types[0]?.type ?? 'lsp');
	const [source, setSource] = useState<ImportSource | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [url, setUrl] = useState('');
	const [draft, setDraft] = useState('');
	const [isFetching, setIsFetching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const applyText = (text: string) => {
		let parsed: unknown;

		try {
			parsed = JSON.parse(text);
		} catch {
			setError(t('The provided data is not valid JSON.'));
			return;
		}

		if (looksLikeRecipe(parsed)) {
			setError(null);
			onImported(parsed);
			return;
		}

		const parse = pluginTypeRegistry.get(type)?.parseImport;

		if (!parse) {
			setError(t('This recipe type does not support import.'));
			return;
		}

		try {
			setError(null);
			onImported(parse(JSON.stringify(parsed)));
		} catch (e) {
			setError(
				e instanceof Error ? e.message : t('Could not read the recipe.'),
			);
		}
	};

	const handleFiles = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;

		try {
			applyText(await file.text());
		} catch {
			setError(t('The selected file could not be read.'));
		}
	};

	const handleUrlImport = async () => {
		if (!url.trim()) return;

		setIsFetching(true);
		setError(null);

		try {
			const response = await fetch(url.trim(), { cache: 'no-cache' });
			if (!response.ok) throw new Error(String(response.status));
			applyText(await response.text());
		} catch {
			setError(t('The recipe could not be fetched from that URL.'));
		} finally {
			setIsFetching(false);
		}
	};

	const handleDirectoryImport = async () => {
		setError(null);

		try {
			const dir = await openDialog({ directory: true });
			if (typeof dir !== 'string') return;

			onImported(await loadRecipeFromDirectory(dir));
		} catch (e) {
			setError(e instanceof Error ? e.message : t('Could not load recipe'));
		}
	};

	return (
		<div
			ref={dropRef}
			className={`recipe-import${isDragging ? ' dragging' : ''}`}
			onDragOver={(e) => {
				e.preventDefault();
				setIsDragging(true);
			}}
			onDragLeave={(e) => {
				if (!dropRef.current?.contains(e.relatedTarget as Node)) {
					setIsDragging(false);
				}
			}}
			onDrop={(e) => {
				e.preventDefault();
				setIsDragging(false);
				void handleFiles(e.dataTransfer.files);
			}}
		>
			<div className='recipe-form-header'>
				<h3>{t('Import recipe')}</h3>
			</div>

			{!category && (
				<div className='form-group'>
					<label htmlFor='recipe-import-type'>{t('Recipe type')}</label>
					<select
						id='recipe-import-type'
						value={type}
						onChange={(e) => setType(e.target.value)}
					>
						{types.map((definition) => (
							<option key={definition.type} value={definition.type}>
								{definition.label}
							</option>
						))}
					</select>
				</div>
			)}

			<div className='recipe-import-options'>
				<label className='import-option-button'>
					<UploadIcon />
					<div>
						<strong>{t('From file')}</strong>
						<p>{t('Select or drop a JSON recipe file')}</p>
					</div>
					<input
						type='file'
						accept='.json,application/json'
						style={{ display: 'none' }}
						onChange={(e) => void handleFiles(e.target.files)}
					/>
				</label>

				<label
					className='import-option-button'
					onClick={() => void handleDirectoryImport()}
				>
					<FolderIcon />
					<div>
						<strong>{t('From directory')}</strong>
						<p>{t('Load a recipe.json with its Dockerfile and extra files')}</p>
					</div>
				</label>

				<label
					className='import-option-button'
					onClick={() => setSource(source === 'url' ? null : 'url')}
				>
					<UrlIcon />
					<div>
						<strong>{t('From URL')}</strong>
						<p>{t('Fetch a recipe published as JSON')}</p>
					</div>
				</label>

				<label
					className='import-option-button'
					onClick={() => setSource(source === 'json' ? null : 'json')}
				>
					<FileIcon />
					<div>
						<strong>{t('Enter JSON')}</strong>
						<p>{t('Paste a TeXlyre configuration block or a recipe')}</p>
					</div>
				</label>
			</div>

			{error && <div className='error-message'>{error}</div>}

			{source === 'url' && (
				<div className='form-group'>
					<label htmlFor='recipe-import-url'>{t('Recipe URL')}</label>
					<input
						id='recipe-import-url'
						type='text'
						value={url}
						dir='ltr'
						placeholder='https://example.org/recipe.json'
						onChange={(e) => setUrl(e.target.value)}
					/>
					<button
						className='button primary'
						disabled={!url.trim() || isFetching}
						onClick={() => void handleUrlImport()}
					>
						{isFetching ? t('Fetching...') : t('Fetch')}
					</button>
				</div>
			)}

			{source === 'json' && (
				<div className='form-group'>
					<label htmlFor='recipe-import-json'>{t('Recipe JSON')}</label>
					<textarea
						id='recipe-import-json'
						rows={10}
						spellCheck={false}
						dir='ltr'
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
					/>
					<button
						className='button primary'
						disabled={!draft.trim()}
						onClick={() => applyText(draft)}
					>
						{t('Import')}
					</button>
				</div>
			)}

			<div className='form-actions'>
				<button className='button secondary' onClick={onCancel}>
					{t('Cancel')}
				</button>
			</div>
		</div>
	);
};

export default RecipeImport;
