// src/components/plugin-host/RendezvousAvatars.tsx
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

import {
	acquireRendezvous,
	type RendezvousLease,
} from '@chelys/peer/RendezvousRoom';
import { resolveSignalingServers } from '../../peer/BridgeResolution';
import type { Recipe } from '../../plugin-host/types';
import CollaboratorAvatars from '../common/CollaboratorAvatars';

interface RendezvousAvatarsProps {
	recipe: Recipe;
	active: boolean;
}

interface SharedTransportConfig {
	transportRoomId?: unknown;
	signalingServers?: unknown;
}

const RendezvousAvatars: React.FC<RendezvousAvatarsProps> = ({
	recipe,
	active,
}) => {
	const [awareness, setAwareness] = useState<Awareness | null>(null);

	const config = recipe.typeConfig as SharedTransportConfig;
	const roomId =
		typeof config.transportRoomId === 'string' && config.transportRoomId.trim()
			? config.transportRoomId.trim()
			: null;
	const signaling = useMemo(
		() =>
			resolveSignalingServers(
				Array.isArray(config.signalingServers)
					? config.signalingServers.filter(
							(value): value is string => typeof value === 'string',
						)
					: undefined,
			),
		[config.signalingServers],
	);

	useEffect(() => {
		if (!active || !roomId) {
			setAwareness(null);
			return;
		}

		const lease: RendezvousLease = acquireRendezvous(roomId, signaling);
		const unsubscribe = lease.subscribe((connection) => {
			setAwareness(connection.awareness);
		});

		return () => {
			unsubscribe();
			lease.release();
			setAwareness(null);
		};
	}, [active, roomId, signaling]);

	return (
		<div className='recipe-awareness'>
			{awareness && (
				<CollaboratorAvatars awareness={awareness} maxVisible={4} />
			)}
		</div>
	);
};

export default RendezvousAvatars;
