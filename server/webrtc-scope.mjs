// server/webrtc-scope.mjs
export function createHeadlessWebRtcScope(NativeRTCPeerConnection) {
	const peersByScope = new Map();
	const connectedByScope = new Map();
	const listenersByScope = new Map();
	const peerScopes = new WeakMap();

	const count = (scopeId) => connectedByScope.get(scopeId)?.size ?? 0;
	const notify = (scopeId) => {
		const connected = count(scopeId);
		for (const listener of listenersByScope.get(scopeId) ?? [])
			listener(connected);
	};
	const setConnected = (peer, connected) => {
		const record = peerScopes.get(peer);
		if (!record || record.connected === connected) return;
		record.connected = connected;
		const peers = connectedByScope.get(record.scopeId) ?? new Set();
		if (connected) {
			peers.add(peer);
			connectedByScope.set(record.scopeId, peers);
		} else {
			peers.delete(peer);
			if (peers.size === 0) connectedByScope.delete(record.scopeId);
		}
		notify(record.scopeId);
	};
	const unregister = (peer) => {
		const record = peerScopes.get(peer);
		if (!record) return;
		peer.removeEventListener('iceconnectionstatechange', record.onIce);
		peer.removeEventListener('connectionstatechange', record.onConnection);
		setConnected(peer, false);
		peerScopes.delete(peer);
		const peers = peersByScope.get(record.scopeId);
		peers?.delete(peer);
		if (peers?.size === 0) peersByScope.delete(record.scopeId);
	};

	class ScopedRTCPeerConnection extends NativeRTCPeerConnection {
		constructor(configuration = {}, ...args) {
			const scopeId =
				typeof configuration?.__chelysRuntimeScope === 'string'
					? configuration.__chelysRuntimeScope
					: null;
			const nativeConfiguration =
				scopeId === null
					? configuration
					: Object.fromEntries(
							Object.entries(configuration).filter(
								([key]) => key !== '__chelysRuntimeScope',
							),
						);
			super(nativeConfiguration, ...args);
			if (scopeId === null) return;

			const onIce = () => {
				const state = this.iceConnectionState;
				if (state === 'connected' || state === 'completed')
					setConnected(this, true);
				else if (
					state === 'disconnected' ||
					state === 'failed' ||
					state === 'closed'
				)
					setConnected(this, false);
			};
			const onConnection = () =>
				setConnected(this, this.connectionState === 'connected');
			peerScopes.set(this, { scopeId, onIce, onConnection, connected: false });
			const peers = peersByScope.get(scopeId) ?? new Set();
			peers.add(this);
			peersByScope.set(scopeId, peers);
			this.addEventListener('iceconnectionstatechange', onIce);
			this.addEventListener('connectionstatechange', onConnection);
			onIce();
			if (this.connectionState === 'connected') onConnection();
		}

		close() {
			unregister(this);
			return super.close();
		}
	}

	const control = {
		getConnectedCount: count,
		subscribe(scopeId, listener) {
			const listeners = listenersByScope.get(scopeId) ?? new Set();
			listeners.add(listener);
			listenersByScope.set(scopeId, listeners);
			listener(count(scopeId));
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) listenersByScope.delete(scopeId);
			};
		},
		async reset(scopeId) {
			const peers = [...(peersByScope.get(scopeId) ?? [])];
			const results = await Promise.allSettled(
				peers.map(async (peer) => {
					try {
						await peer.close();
					} finally {
						unregister(peer);
					}
				}),
			);
			for (const result of results) {
				if (result.status === 'rejected')
					console.warn(
						'[Chelys] Failed to close scoped WebRTC peer:',
						result.reason,
					);
			}
		},
	};

	return { RTCPeerConnection: ScopedRTCPeerConnection, control };
}
