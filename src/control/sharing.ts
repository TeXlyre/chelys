// src/control/sharing.ts
import { getActiveAccountId } from '../plugin-host/activeAccount';
import type { RequestOrigin } from './policy';
import { accessPolicy } from './policy';

export type ShareMode = 'disabled' | 'peers' | 'keys';
export interface SharePolicy {
	mode: ShareMode;
	fields: string[];
}
const PREFIX = 'chelys-inspection-share:';

function key(recipeId: string): string {
	const account = getActiveAccountId();
	if (!account) throw new Error('Login required');
	return `${PREFIX}${account}:${recipeId}`;
}

export const inspectionSharing = {
	get(recipeId: string): SharePolicy {
		try {
			const value = JSON.parse(localStorage.getItem(key(recipeId)) || 'null');
			return {
				mode:
					value?.mode === 'peers' || value?.mode === 'keys'
						? value.mode
						: 'disabled',
				fields: Array.isArray(value?.fields)
					? value.fields.filter((s: unknown) => typeof s === 'string')
					: [],
			};
		} catch {
			return { mode: 'disabled', fields: [] };
		}
	},
	set(
		recipeId: string,
		mode: ShareMode,
		fields: string[],
		available: string[],
	): SharePolicy {
		if (!['disabled', 'peers', 'keys'].includes(mode))
			throw new Error('Unknown sharing mode');
		if (
			!Array.isArray(fields) ||
			fields.some(
				(name) => typeof name !== 'string' || !available.includes(name),
			)
		) {
			throw new Error('Unknown inspection field');
		}
		const next = { mode, fields: [...new Set(fields)] };
		localStorage.setItem(key(recipeId), JSON.stringify(next));
		return next;
	},
	async visibleFields(
		recipeId: string,
		origin: RequestOrigin,
		available: string[],
	): Promise<string[]> {
		if (origin.transport === 'local') return available;
		const allowed: string[] = [];
		for (const field of available) {
			try {
				await this.check(recipeId, origin, [field]);
				allowed.push(field);
			} catch {}
		}
		return allowed;
	},
	async check(
		recipeId: string,
		origin: RequestOrigin,
		fields: string[],
	): Promise<void> {
		if (origin.transport === 'local') return;
		const share = this.get(recipeId);
		if (
			share.mode === 'disabled' ||
			fields.some((field) => !share.fields.includes(field))
		) {
			throw new Error('Requested metrics are not shared by this instance');
		}
		if (share.mode === 'peers') {
			if (
				accessPolicy.mode() !== 'peers' ||
				origin.transport !== 'webrtc' ||
				(origin.peerKind !== 'chelys' && origin.peerKind !== 'texlyre')
			) {
				throw new Error(
					'These metrics are available only to verified account peers',
				);
			}
			return;
		}
		if (accessPolicy.mode() !== 'keys')
			throw new Error('API-key policy must be active');
		await accessPolicy.authorize(origin, 'recipes.telemetry.read', fields);
	},
};
