// tests/unit/control/secrets.test.ts
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, parseSecretId } from '@src/control/secretCrypto';

describe('TeXlyre-compatible encrypted secrets', () => {
	it('round-trips with salt, IV and authenticated AES-GCM', async () => {
		const cipher = await encryptSecret('private-value', 'password');
		expect(cipher).not.toContain('private-value');
		expect(await decryptSecret(cipher, 'password')).toBe('private-value');
		await expect(decryptSecret(cipher, 'incorrect')).rejects.toThrow('Unable to decrypt');
	});
	it('uses existing secret IDs and refuses malformed scopes', () => {
		expect(parseSecretId('plugin:global:token').scope).toBe('global');
		expect(parseSecretId('plugin:project:abc:token').projectId).toBe('abc');
		expect(() => parseSecretId('plugin:project:token')).toThrow('require a project');
	});
});
