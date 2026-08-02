import type React from 'react';
import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

import { chelysAccountSyncService } from '@texlyre/services/ChelysAccountSyncService';
import CollaboratorAvatars from '../common/CollaboratorAvatars';

const AccountCollabIndicator: React.FC = () => {
	const [awareness, setAwareness] = useState<Awareness | null>(
		() => chelysAccountSyncService.getConnection()?.awareness ?? null,
	);

	useEffect(
		() =>
			chelysAccountSyncService.subscribe((connection) => {
				setAwareness(connection?.awareness ?? null);
			}),
		[],
	);

	return awareness ? (
		<CollaboratorAvatars awareness={awareness} maxVisible={4} />
	) : null;
};

export default AccountCollabIndicator;
