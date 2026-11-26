// server/signaling-websocket.mjs
const endpoint = (value, allowHttp = false) => {
	try {
		const url = new URL(String(value));
		if (allowHttp && url.protocol === 'http:') url.protocol = 'ws:';
		if (allowHttp && url.protocol === 'https:') url.protocol = 'wss:';
		return url.protocol === 'ws:' || url.protocol === 'wss:' ? url : null;
	} catch {
		return null;
	}
};

const matchesEndpoint = (target, value, allowHttp) => {
	const server = endpoint(value, allowHttp);
	if (
		!server ||
		target.protocol !== server.protocol ||
		target.host !== server.host
	)
		return false;
	const path = server.pathname.replace(/\/+$/, '') || '/';
	return (
		path === '/' ||
		target.pathname === path ||
		target.pathname.startsWith(`${path}/`)
	);
};

function isSignalingUrl(address, storage) {
	const target = endpoint(address);
	if (!target) return false;
	if (/^(?:ywebrtc|yweb|filepizza)\./i.test(target.hostname)) return true;

	// Saved dedicated invitations may specify signaling servers different from
	// this account's defaults. Do not apply the Origin to direct control URLs.
	try {
		const peers = JSON.parse(storage.getItem('chelys-peer-endpoints') || '{}');
		for (const value of Object.values(peers)) {
			if (
				typeof value !== 'string' ||
				!value.startsWith('chelys-webrtc:') ||
				value.length > 65_536
			)
				continue;
			try {
				const invitation = JSON.parse(
					Buffer.from(value.slice('chelys-webrtc:'.length), 'base64').toString(
						'utf8',
					),
				);
				if (
					Array.isArray(invitation.signaling) &&
					invitation.signaling.some(
						(server) =>
							typeof server === 'string' &&
							matchesEndpoint(target, server, false),
					)
				)
					return true;
			} catch {
				/* Ignore malformed saved invitations. */
			}
		}
	} catch {
		/* Ignore malformed saved endpoints. */
	}

	for (let index = 0; index < storage.length; index++) {
		const key = storage.key(index);
		if (
			!key ||
			!/(?:^texlyre-settings$|^(?:chelys|texlyre)-user-.+-settings$)/.test(key)
		)
			continue;
		let settings;
		try {
			settings = JSON.parse(storage.getItem(key) ?? '{}');
		} catch {
			continue;
		}
		const servers = [
			settings?.['collab-signaling-servers'],
			settings?.collabSignalingServers,
			settings?.['collab-websocket-server'],
			settings?.['file-sync-server-url'],
		];
		if (
			servers.some(
				(value, i) =>
					typeof value === 'string' &&
					value
						.split(',')
						.some((candidate) =>
							matchesEndpoint(target, candidate.trim(), i === 3),
						),
			)
		)
			return true;
	}
	return false;
}

export function createSignalingWebSocket(
	WebSocket,
	storage,
	origin = () => undefined,
) {
	return class extends WebSocket {
		constructor(url, protocols, options) {
			if (!isSignalingUrl(url, storage)) {
				super(url, protocols, options);
				return;
			}
			const configured = typeof origin === 'function' ? origin() : origin;
			const value = process.env.CHELYS_SIGNALING_ORIGIN?.trim() || configured;
			if (typeof value !== 'string' || !value.trim()) {
				super(url, protocols, options);
				return;
			}
			if (
				protocols &&
				typeof protocols === 'object' &&
				!Array.isArray(protocols)
			) {
				super(url, { ...protocols, origin: value.trim() });
				return;
			}
			super(url, protocols, { ...options, origin: value.trim() });
		}
	};
}
