// src/components/app/AppRouter.tsx
import type React from 'react';

import { useRoom } from '../../hooks/useRoom';
import ChelysLogin from '../auth/ChelysLogin';
import DashboardApp from './DashboardApp';

const AppRouter: React.FC = () => {
	const { identity, isInitializing } = useRoom();
	if (isInitializing) return <p className='loading'>Loading…</p>;
	return identity ? <DashboardApp /> : <ChelysLogin />;
};

export default AppRouter;
