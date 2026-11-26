// src/components/common/CredentialStorageWarning.tsx
import type React from 'react';
import { useRoom } from '../../hooks/useRoom';

const CredentialStorageWarning: React.FC = () => {
	const { credentialWarning } = useRoom();
	if (!credentialWarning) return null;
	return (
		<div className='warning-message' role='alert'>
			{credentialWarning}
		</div>
	);
};

export default CredentialStorageWarning;
