// src/components/plugin-host/RecipeBrowser.tsx
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import type { RegistryEntry } from '../../plugin-host/types';
import { SearchIcon } from '../common/Icons';

interface RecipeBrowserProps {
	onDone: () => void;
}

const RECIPES_PER_PAGE = 12;

const RecipeBrowser: React.FC<RecipeBrowserProps> = ({ onDone }) => {
	const { registry, refreshRegistry, installFromRegistry } = usePluginHost();
	const [loadError, setLoadError] = useState<string | null>(null);
	const [installError, setInstallError] = useState<string | null>(null);
	const [installing, setInstalling] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [category, setCategory] = useState('');
	const [currentPage, setCurrentPage] = useState(1);
	const [icons, setIcons] = useState<Record<string, string>>({});
	const [versions, setVersions] = useState<Record<string, string>>({});

	useEffect(() => {
		refreshRegistry().catch((e) =>
			setLoadError(e instanceof Error ? e.message : t('Could not load registry')),
		);
	}, []);

	const categories = useMemo(
		() => Array.from(new Set(registry.map((entry) => entry.type))),
		[registry],
	);

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		return registry.filter((entry) => {
			const matchesQuery =
				!q ||
				entry.name.toLowerCase().includes(q) ||
				(entry.description ?? '').toLowerCase().includes(q) ||
				(entry.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
			const matchesCategory = !category || entry.type === category;
			return matchesQuery && matchesCategory;
		});
	}, [registry, query, category]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / RECIPES_PER_PAGE));

	const paginated = useMemo(() => {
		const start = (currentPage - 1) * RECIPES_PER_PAGE;
		return filtered.slice(start, start + RECIPES_PER_PAGE);
	}, [filtered, currentPage]);

	useEffect(() => {
		if (currentPage > totalPages) setCurrentPage(1);
	}, [totalPages, currentPage]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			for (const entry of paginated) {
				if (entry.icon || entry.iconUrl || icons[entry.id]) continue;
				try {
					const res = await fetch(entry.manifestUrl, { cache: 'force-cache' });
					if (!res.ok) continue;
					const manifest = (await res.json()) as {
						icon?: string;
						iconUrl?: string;
					};
					const resolved = manifest.icon ?? manifest.iconUrl;
					if (resolved && !cancelled) {
						setIcons((prev) => ({ ...prev, [entry.id]: resolved }));
					}
				} catch {
					/* leave fallback */
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [paginated]);

	const handleInstall = async (entry: RegistryEntry) => {
		setInstallError(null);
		setInstalling(entry.id);
		try {
			await installFromRegistry(entry, versions[entry.id]);
			onDone();
		} catch (e) {
			setInstallError(
				e instanceof Error ? e.message : t('Could not add recipe'),
			);
		} finally {
			setInstalling(null);
		}
	};

	const handleSearchChange = (value: string) => {
		setQuery(value);
		setCurrentPage(1);
	};

	const handleCategoryChange = (value: string) => {
		setCategory(value);
		setCurrentPage(1);
	};

	const goToPage = (page: number) => {
		if (page >= 1 && page <= totalPages) setCurrentPage(page);
	};

	const typeLabel = (type: string) =>
		pluginTypeRegistry.get(type)?.label ?? type;

	const visiblePages = useMemo(() => {
		const maxVisible = 5;
		let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
		const end = Math.min(totalPages, start + maxVisible - 1);
		if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
		const pages: number[] = [];
		for (let i = start; i <= end; i++) pages.push(i);
		return pages;
	}, [currentPage, totalPages]);

	const startItem =
		filtered.length === 0 ? 0 : (currentPage - 1) * RECIPES_PER_PAGE + 1;
	const endItem = Math.min(currentPage * RECIPES_PER_PAGE, filtered.length);

	return (
		<div className='recipe-browser'>
			<div className='recipe-browser-header'>
				<h3>{t('Browse recipes')}</h3>
				<button className='action-button' onClick={onDone}>
					{t('Back')}
				</button>
			</div>

			<div className='recipe-browser-controls'>
				<div className='recipe-search'>
					<SearchIcon />
					<input
						type='text'
						value={query}
						onChange={(e) => handleSearchChange(e.target.value)}
						placeholder={t('Search recipes…')}
					/>
				</div>
				{categories.length > 1 && (
					<select
						value={category}
						onChange={(e) => handleCategoryChange(e.target.value)}
					>
						<option value=''>{t('All types')}</option>
						{categories.map((type) => (
							<option key={type} value={type}>
								{typeLabel(type)}
							</option>
						))}
					</select>
				)}
			</div>

			{loadError && <div className='recipe-error'>{loadError}</div>}
			{installError && <div className='recipe-error'>{installError}</div>}

			{!loadError && filtered.length === 0 && (
				<p className='no-recipes'>
					{registry.length === 0
						? t('No recipes available.')
						: t('No recipes match your search.')}
				</p>
			)}

			{paginated.map((entry) => {
				const resolved = entry.icon ?? entry.iconUrl ?? icons[entry.id];
				const isMarkup = !!resolved && resolved.trimStart().startsWith('<');
				const icon = resolved ?? pluginTypeRegistry.get(entry.type)?.icon;
				return (
					<div key={entry.id} className='recipe-card'>
						<div className='recipe-card-main'>
							<div className='recipe-card-info'>
								{isMarkup ? (
									<span
										className='recipe-icon'
										aria-hidden='true'
										dangerouslySetInnerHTML={{ __html: icon }}
									/>
								) : resolved ? (
									<span className='recipe-icon' aria-hidden='true'>
										<img src={resolved} alt='' />
									</span>
								) : (
									<span
										className='recipe-icon'
										aria-hidden='true'
										dangerouslySetInnerHTML={{ __html: icon }}
									/>
								)}
								<span className='recipe-name'>{entry.name}</span>
								{entry.version && (
									<span className='recipe-version-badge'>latest: v{entry.version}</span>
								)}
								<span className='recipe-type-badge'>{typeLabel(entry.type)}</span>
							</div>
						</div>

						{entry.description && (
							<p className='recipe-browser-description'>{entry.description}</p>
						)}

						{entry.tags && entry.tags.length > 0 && (
							<div className='recipe-browser-tags'>
								{entry.tags.map((tag) => (
									<span key={tag} className='recipe-browser-tag'>
										{tag}
									</span>
								))}
							</div>
						)}

						<div className='recipe-actions'>
							<button
								className='action-button primary'
								disabled={installing === entry.id}
								onClick={() => handleInstall(entry)}
							>
								{installing === entry.id ? (
									<>
										<span className='loading-spinner inline' />
										{t('Adding…')}
									</>
								) : (
									t('Add recipe')
								)}
							</button>
							{entry.versions && entry.versions.length > 1 && (
								<select
									className='recipe-version-select'
									value={versions[entry.id] ?? entry.versions[0].version}
									onChange={(e) =>
										setVersions((prev) => ({
											...prev,
											[entry.id]: e.target.value,
										}))
									}
								>
									{entry.versions.map((v) => (
										<option key={v.version} value={v.version}>
											v{v.version}
										</option>
									))}
								</select>
							)}
						</div>
					</div>
				);
			})}

			{totalPages > 1 && (
				<div className='recipe-pagination'>
					<div className='pagination-info'>
						{t('Showing {startItem}-{endItem} of {count}', {
							startItem,
							endItem,
							count: filtered.length,
						})}
					</div>
					<div className='pagination-controls'>
						<button
							className='pagination-button'
							onClick={() => goToPage(currentPage - 1)}
							disabled={currentPage === 1}
						>
							{t('← Prev')}
						</button>
						{currentPage > 2 && (
							<>
								<button
									className='pagination-button'
									onClick={() => goToPage(1)}
								>
									1
								</button>
								{currentPage > 3 && (
									<span className='pagination-ellipsis'>{t('...')}</span>
								)}
							</>
						)}
						{visiblePages.map((page) => (
							<button
								key={page}
								className={`pagination-button ${page === currentPage ? 'active' : ''}`}
								onClick={() => goToPage(page)}
							>
								{page}
							</button>
						))}
						{currentPage < totalPages - 1 && (
							<>
								{currentPage < totalPages - 2 && (
									<span className='pagination-ellipsis'>{t('...')}</span>
								)}
								<button
									className='pagination-button'
									onClick={() => goToPage(totalPages)}
								>
									{totalPages}
								</button>
							</>
						)}
						<button
							className='pagination-button'
							onClick={() => goToPage(currentPage + 1)}
							disabled={currentPage === totalPages}
						>
							{t('Next →')}
						</button>
					</div>
				</div>
			)}
		</div>
	);
};

export default RecipeBrowser;
