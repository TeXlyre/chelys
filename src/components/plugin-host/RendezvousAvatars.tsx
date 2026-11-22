// src/components/plugin-host/RendezvousAvatars.tsx
import type React from 'react';
import { useEffect, useState } from 'react';
import { localCommand } from '../../control/localClient';
import type { Recipe } from '../../plugin-host/types';
import CollaboratorAvatars, {
	type CollaboratorState,
} from '../common/CollaboratorAvatars';

interface RendezvousAvatarsProps {
	recipe: Recipe;
	active: boolean;
}

/** Display the backend's room presence instead of opening a renderer WebRTC connection. */
const RendezvousAvatars: React.FC<RendezvousAvatarsProps> = ({
	recipe,
	active,
}) => {
	const [snapshot, setSnapshot] = useState<CollaboratorState[]>([]);
	useEffect(() => {
		if (!active) {
			setSnapshot([]);
			return;
		}
		let alive = true;
		const refresh = () => {
			void localCommand<CollaboratorState[]>('recipes.collaborators', {
				id: recipe.id,
			})
				.then((users) => {
					if (alive) setSnapshot(users);
				})
				.catch(() => {
					if (alive) setSnapshot([]);
				});
		};
		refresh();
		const timer = window.setInterval(refresh, 3000);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
	}, [recipe.id, active]);
	return (
		<div className='recipe-awareness'>
			{snapshot.length > 0 && (
				<CollaboratorAvatars snapshot={snapshot} maxVisible={4} />
			)}
		</div>
	);
};
export default RendezvousAvatars;
