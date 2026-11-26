// tests/server/collaboration-settings.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const moduleUrl = new URL(
	'../../src/runtime/collaborationSettings.ts',
	import.meta.url,
).href;
const script = `
import assert from 'node:assert/strict';
import { synchronizeCollaborationSettings } from ${JSON.stringify(moduleUrl)};
function storage(initial = {}) {
 const values = new Map(Object.entries(initial));
 let writes = 0;
 return {
  get writes() { return writes; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, value); writes++; },
 };
}
{
 const local = storage();
 synchronizeCollaborationSettings(local, 'room-1', 'wss://ywebrtc.texlyre.org', true);
 assert.deepEqual(JSON.parse(local.getItem('texlyre-user-room-1-settings')), {
  'collab-signaling-servers': 'wss://ywebrtc.texlyre.org',
  'collab-auto-reconnect': true,
 });
}
{
 const key = 'texlyre-user-room-1-settings';
 const local = storage({ [key]: JSON.stringify({ _version: '1.2', theme: 'dark', 'collab-signaling-servers': 'ws://old' }) });
 synchronizeCollaborationSettings(local, 'room-1', 'wss://new', false);
 assert.deepEqual(JSON.parse(local.getItem(key)), {
  _version: '1.2', theme: 'dark',
  'collab-signaling-servers': 'wss://new',
  'collab-auto-reconnect': false,
 });
}
{
 const first = 'texlyre-user-room-1-settings';
 const second = 'texlyre-user-room-2-settings';
 const data = { 'collab-signaling-servers': 'wss://current', 'collab-auto-reconnect': true };
 const local = storage({ [first]: JSON.stringify(data), [second]: JSON.stringify({ theme: 'light' }) });
 synchronizeCollaborationSettings(local, 'room-1', 'wss://current', true);
 assert.equal(local.writes, 0);
 assert.deepEqual(JSON.parse(local.getItem(second)), { theme: 'light' });
}
{
 const first = 'texlyre-user-room-1-settings';
 for (const invalid of ['{broken', '[]', 'null']) {
  const local = storage({ [first]: invalid });
  assert.throws(() => synchronizeCollaborationSettings(local, 'room-1', 'wss://valid', true));
  assert.equal(local.getItem(first), invalid);
  assert.equal(local.writes, 0);
 }
}
`;

test('desktop and headless use the same account signaling configuration', () => {
	const result = spawnSync(
		process.execPath,
		['--experimental-strip-types', '--input-type=module', '--eval', script],
		{
			encoding: 'utf8',
			timeout: 10_000,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.error?.message);
});
