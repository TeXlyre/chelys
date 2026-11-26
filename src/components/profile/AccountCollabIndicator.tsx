// src/components/profile/AccountCollabIndicator.tsx
import type React from 'react';
import { useEffect, useState } from 'react';
import { localCommand } from '../../control/localClient';
import CollaboratorAvatars, {
	type CollaboratorState,
} from '../common/SnapshotCollaboratorAvatars';

const AccountCollabIndicator: React.FC = () => {
	const [collaborators, setCollaborators] = useState<CollaboratorState[]>([]);
	useEffect(() => {
		let active = true;
		const refresh = () => {
			void localCommand<CollaboratorState[]>('account.collaborators')
				.then((users) => {
					if (active) setCollaborators(users);
				})
				.catch(() => {
					if (active) setCollaborators([]);
				});
		};
		refresh();
		const timer = setInterval(refresh, 3000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, []);
	return collaborators.length ? (
		<CollaboratorAvatars snapshot={collaborators} maxVisible={4} />
	) : null;
};
export default AccountCollabIndicator;
