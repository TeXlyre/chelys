// src/control/secretCrypto.ts
export async function encryptSecret(
	value: string,
	password: string,
): Promise<string> {
	if (!value.trim() || !password)
		throw new Error('Secret value and account password required');
	const bytes = new TextEncoder();
	const material = await crypto.subtle.importKey(
		'raw',
		bytes.encode(password),
		'PBKDF2',
		false,
		['deriveKey'],
	);
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt'],
	);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			bytes.encode(value),
		),
	);
	const result = new Uint8Array(salt.length + iv.length + ciphertext.length);
	result.set(salt);
	result.set(iv, salt.length);
	result.set(ciphertext, salt.length + iv.length);
	return btoa(String.fromCharCode(...result));
}
export async function decryptSecret(
	value: string,
	password: string,
): Promise<string> {
	const data = Uint8Array.from(atob(value), (character) =>
		character.charCodeAt(0),
	);
	if (data.length < 44) throw new Error('Invalid secret ciphertext');
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey'],
	);
	const key = await crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: data.slice(0, 16),
			iterations: 100_000,
			hash: 'SHA-256',
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt'],
	);
	try {
		return new TextDecoder().decode(
			await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: data.slice(16, 28) },
				key,
				data.slice(28),
			),
		);
	} catch {
		throw new Error(
			'Unable to decrypt secret with the current account password',
		);
	}
}
export function parseSecretId(id: string): {
	pluginId: string;
	scope: 'global' | 'project';
	projectId?: string;
	secretKey: string;
} {
	const parts = id.split(':');
	const secretKey = parts.at(-1);
	if (
		(parts.length !== 3 && parts.length !== 4) ||
		!parts[0] ||
		!secretKey ||
		!['global', 'project'].includes(parts[1])
	) {
		throw new Error(
			'Secret ID format: pluginId:global:secretKey or pluginId:project:projectId:secretKey',
		);
	}
	if (parts[1] === 'project' && parts.length !== 4)
		throw new Error('Project secrets require a project ID');
	if (parts[1] === 'global' && parts.length !== 3)
		throw new Error('Global secret ID has three parts');
	return {
		pluginId: parts[0],
		scope: parts[1] as 'global' | 'project',
		...(parts.length === 4 ? { projectId: parts[2] } : {}),
		secretKey,
	};
}
