// tests/server/secrets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = fs.readFileSync(
	new URL('../../src/control/secretCrypto.ts', import.meta.url),
	'utf8',
);
const { encryptSecret, decryptSecret, parseSecretId } = await import(
	`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`
);

test('TeXlyre-compatible encryption round trips and rejects wrong password', async () => {
	const encoded = await encryptSecret('unicode: café 🎓', 'very secret');
	assert.ok(/^[A-Za-z0-9+/=]+$/.test(encoded));
	assert.equal(await decryptSecret(encoded, 'very secret'), 'unicode: café 🎓');
	await assert.rejects(decryptSecret(encoded, 'wrong'), /Unable to decrypt/);
});
test('secret identifier validates scoped layout', () => {
	assert.deepEqual(parseSecretId('example:global:token'), {
		pluginId: 'example',
		scope: 'global',
		secretKey: 'token',
	});
	assert.deepEqual(parseSecretId('example:project:doc-1:token'), {
		pluginId: 'example',
		scope: 'project',
		projectId: 'doc-1',
		secretKey: 'token',
	});
	assert.throws(() => parseSecretId('bad:project:token'), /Project secrets/);
});
