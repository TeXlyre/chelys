// src/peer/RendezvousPresence.ts
import {
	acquireRendezvous,
	type RendezvousLease,
} from '@chelys/peer/RendezvousRoom';
import { getAccountControlUser } from '@chelys/peer/AccountControlRoom';
import { resolveSignalingServers } from './BridgeResolution';
import type { Recipe } from '../plugin-host/types';

export interface PresenceEntry {
	clientId: number;
	isLocal: boolean;
	user: { username: string; name?: string; color: string; colorLight?: string };
}

/** A single process owns recipe-room awareness; the renderer never joins a duplicate WebRTC room. */
class RendezvousPresence {
	private entries = new Map<
		string,
		{ signature: string; lease: RendezvousLease }
	>();

	list(recipe: Recipe, running: boolean): PresenceEntry[] {
		if (!running) {
			this.stop(recipe.id);
			return [];
		}
		const config = recipe.typeConfig as {
			transportRoomId?: unknown;
			signalingServers?: unknown;
		};
		const roomId =
			typeof config.transportRoomId === 'string'
				? config.transportRoomId.trim()
				: '';
		if (!roomId) {
			this.stop(recipe.id);
			return [];
		}
		const explicit = Array.isArray(config.signalingServers)
			? config.signalingServers.filter(
					(value): value is string => typeof value === 'string',
				)
			: undefined;
		const signaling = resolveSignalingServers(explicit);
		const signature = JSON.stringify([roomId, signaling]);
		let active = this.entries.get(recipe.id);
		if (active?.signature !== signature) {
			this.stop(recipe.id);
			active = {
				signature,
				lease: acquireRendezvous(roomId, signaling, getAccountControlUser()),
			};
			this.entries.set(recipe.id, active);
		}
		const awareness = active.lease.connection.awareness;
		const users: PresenceEntry[] = [];
		for (const [clientId, state] of awareness.getStates()) {
			const user = state.user;
			if (!user || typeof user.username !== 'string') continue;
			users.push({
				clientId,
				isLocal: clientId === awareness.clientID,
				user: {
					username: user.username,
					...(typeof user.name === 'string' ? { name: user.name } : {}),
					color: typeof user.color === 'string' ? user.color : '#64748b',
					...(typeof user.colorLight === 'string'
						? { colorLight: user.colorLight }
						: {}),
				},
			});
		}
		return users.sort(
			(a, b) =>
				Number(b.isLocal) - Number(a.isLocal) ||
				a.user.username.localeCompare(b.user.username),
		);
	}

	stop(id: string): void {
		const entry = this.entries.get(id);
		if (entry) {
			this.entries.delete(id);
			entry.lease.release();
		}
	}

	prune(isRunning: (id: string) => boolean): void {
		for (const id of this.entries.keys()) if (!isRunning(id)) this.stop(id);
	}

	stopAll(): void {
		for (const id of [...this.entries.keys()]) this.stop(id);
	}
}

export const rendezvousPresence = new RendezvousPresence();
