// src/components/plugin-host/RecipeShareActions.tsx
import type React from 'react';
import { useMemo, useRef, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import {
	applyShareMode,
	describeRecipeShare,
	readShareMode,
	type ShareMode,
} from '../../plugin-host/recipeSharing';
import type { Recipe } from '../../plugin-host/types';
import IconButton from '../common/IconButton';
import Popover from '../common/Popover';
import { DownloadIcon, ShareIcon } from '../common/Icons';

interface RecipeShareActionsProps {
	recipe: Recipe;
	transportLocked?: boolean;
}

const MODE_LABELS: Record<ShareMode, string> = {
	websocket: 'WebSocket URL',
	'webrtc-room': 'WebRTC room',
	'webrtc-account': 'WebRTC, account only',
};

const MODE_HINTS: Record<ShareMode, string> = {
	websocket: 'Collaborators connect to the server address directly.',
	'webrtc-room': 'Anyone holding the room joins the peer connection.',
	'webrtc-account': 'Reachable from your own account only. Not shareable.',
};

const downloadJson = async (fileName: string, contents: string) => {
	const path = await saveDialog({
		defaultPath: fileName,
		filters: [{ name: 'JSON', extensions: ['json'] }],
	});
	if (typeof path !== 'string') return;

	await writeTextFile(path, contents);
};

const RecipeShareActions: React.FC<RecipeShareActionsProps> = ({
	recipe,
	transportLocked = false,
}) => {
	const { save } = usePluginHost();
	const share = useMemo(() => describeRecipeShare(recipe), [recipe]);
	const mode = readShareMode(recipe);
	const anchorRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!share.json) return;

		await navigator.clipboard.writeText(share.json);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const blocked = share.state === 'blocked' || !share.json;

	return (
		<>
			<IconButton
				icon={<DownloadIcon />}
				label={t('Download recipe')}
				tooltip={t('Saves the Chelys recipe so it can be imported elsewhere.')}
				onClick={() =>
					void downloadJson(
						`${recipe.id || recipe.type}.recipe.json`,
						JSON.stringify(recipe, null, 2),
					)
				}
			/>

			<div className='recipe-share' ref={anchorRef}>
				<IconButton
					icon={<ShareIcon />}
					label={t('Share')}
					tooltip={t('Choose a transport and hand this recipe to TeXlyre.')}
					variant={share.state === 'warning' ? 'warn' : undefined}
					onClick={() => setOpen(!open)}
				/>

				<Popover
					anchor={anchorRef}
					open={open}
					className='recipe-share-menu'
					side='start'
					clampHeight
					onClose={() => setOpen(false)}
				>
					<span className='recipe-share-menu-title'>{t('Transport')}</span>
					{(Object.keys(MODE_LABELS) as ShareMode[]).map((option) => (
						<button
							key={option}
							className={`recipe-share-option${mode === option ? ' active' : ''}`}
							disabled={transportLocked}
							onClick={() => void save(applyShareMode(recipe, option))}
						>
							<strong>{t(MODE_LABELS[option])}</strong>
							<small>{t(MODE_HINTS[option])}</small>
						</button>
					))}

					{transportLocked && (
						<p className='recipe-share-note'>
							{t('Stop the recipe to change its transport.')}
						</p>
					)}
					{!transportLocked && share.message && (
						<p className='recipe-share-note'>{share.message}</p>
					)}

					<span className='recipe-share-menu-title'>
						{t('TeXlyre configuration')}
					</span>
					<button
						className='recipe-share-action'
						disabled={blocked}
						onClick={() => void handleCopy()}
					>
						{copied ? t('Copied!') : t('Copy to clipboard')}
					</button>
					<button
						className='recipe-share-action'
						disabled={blocked}
						onClick={() =>
							share.json && void downloadJson(share.fileName, share.json)
						}
					>
						{t('Download for TeXlyre')}
					</button>
				</Popover>
			</div>
		</>
	);
};

export default RecipeShareActions;
