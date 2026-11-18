// src/runtime/lifecycle.ts
import { deriveIdentity, fromHex } from '@chelys/protocol';
import { chelysAccountSyncService } from '@texlyre/services/ChelysAccountSyncService';
import { setActiveAccountId } from '../plugin-host/activeAccount';
import { getStoredSetting } from '../config';
import { synchronizeCollaborationSettings } from './collaborationSettings';
import { recipeManager } from '../plugin-host/RecipeManager';
import { registerChelysPlugins } from './registerPlugins';
import { remoteControlHost } from '../control/webrtc';

export interface Credentials {
	username: string;
	password: string;
	prf_output_hex: string;
}
export function validateCredentials(credentials: Credentials): void {
	if (
		!credentials.username?.trim() ||
		!credentials.password ||
		!/^(?:[a-f\d]{2})+$/i.test(credentials.prf_output_hex || '')
	) {
		throw new Error(
			'Username, password and valid hexadecimal PRF output required',
		);
	}
}
export async function initializeChelysRecipes(): Promise<void> {
	registerChelysPlugins();
	await recipeManager.initialize();
}
export async function startAccountConnection(
	roomId: string,
	roomKey: string,
	username: string,
): Promise<void> {
	setActiveAccountId(roomId);
	try {
		synchronizeCollaborationSettings(
			localStorage,
			roomId,
			getStoredSetting<string>('collabSignalingServers'),
			getStoredSetting<boolean>('collabAutoReconnect'),
		);
		await chelysAccountSyncService.start(roomId, roomKey, roomId, username);
		remoteControlHost.start();
		await recipeManager.reinjectRunning();
	} catch (error) {
		stopAccountConnection();
		throw error;
	}
}
export function stopAccountConnection(): void {
	remoteControlHost.stop();
	chelysAccountSyncService.stop();
	setActiveAccountId(null);
}
export async function activateCredentials(
	credentials: Credentials,
	beforeStart?: (username: string, roomId: string) => void | Promise<void>,
): Promise<{ roomId: string; username: string }> {
	validateCredentials(credentials);
	const identity = await deriveIdentity({
		username: credentials.username,
		password: credentials.password,
		prfOutput: fromHex(credentials.prf_output_hex),
	});
	await beforeStart?.(credentials.username, identity.roomId);
	await startAccountConnection(
		identity.roomId,
		identity.roomKey,
		credentials.username,
	);
	return { roomId: identity.roomId, username: credentials.username };
}
