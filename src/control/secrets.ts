// src/control/secrets.ts
import { accountStores } from './stores';
import { encryptSecret, decryptSecret, parseSecretId } from './secretCrypto';

export async function setPlainSecret(
	id: string,
	value: string,
	password: string,
): Promise<void> {
	const info = parseSecretId(id);
	accountStores.set('secrets', id, {
		...info,
		encryptedValue: await encryptSecret(value, password),
		lastModified: Date.now(),
	});
}
export async function getPlainSecret(
	id: string,
	password: string,
): Promise<string> {
	const item = accountStores.get('secrets', id) as { encryptedValue?: string };
	if (!item || typeof item.encryptedValue !== 'string')
		throw new Error('Stored secret has no encrypted value');
	return decryptSecret(item.encryptedValue, password);
}
