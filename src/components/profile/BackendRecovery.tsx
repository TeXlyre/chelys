import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackendOwnershipSection from '../settings/BackendOwnershipSection';

/** Native recovery is deliberately independent of the backend and its storage. */
export default function BackendRecovery({ reason }: { reason?: string }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(reason ?? null);
	const retry = async () => {
		setBusy(true);
		setError(null);
		try {
			await invoke('instance_retry');
			// Re-run the normal startup/storage initialization after a successful attach.
			window.location.reload();
		} catch (caught) {
			setError(String(caught));
			setBusy(false);
		}
	};
	return (
		<main className='backend-recovery'>
			<div className='backend-recovery-content'>
				<h2>Chelys backend unavailable</h2>
				<p>The desktop could not connect to its local backend. You can retry here or change how it starts.</p>
				{error && <p className='error-message' role='alert'>{error}</p>}
				<button type='button' onClick={() => void retry()} aria-busy={busy} disabled={busy}>
					{busy ? 'Connecting…' : 'Retry connection'}
				</button>
				<BackendOwnershipSection compact />
				<p className='setting-description'>
					You can also recover without the desktop: <code>chelys runtime preference automatic</code>,
					 then reopen Chelys. This command does not need a running backend.
				</p>
			</div>
		</main>
	);
}
