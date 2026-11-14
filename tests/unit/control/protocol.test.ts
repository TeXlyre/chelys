// tests/unit/control/protocol.test.ts
import { describe, expect, it } from 'vitest';
import { handleRpc, parseRequest } from '@src/control/protocol';

describe('control RPC framing', () => {
	it('validates version, method, id and size', () => {
		expect(() => parseRequest(JSON.stringify({ v: 2, id: 'test', method: 'recipes.list' }))).toThrow();
		expect(() => parseRequest(JSON.stringify({ v: 1, id: 'test', method: 'recipes.list' }))).not.toThrow();
		expect(() => parseRequest(JSON.stringify({ v: 1, id: 'test', method: 'recipes.list', params: { payload: 'x'.repeat(65_537) } }))).not.toThrow();
		expect(() => parseRequest('x'.repeat(2_097_153))).toThrow('large');
	});
	it('serializes successful and failed requests consistently', async () => {
		const request = JSON.stringify({ v: 1, id: 'request-1', method: 'recipes.list' });
		expect(await handleRpc(request, async () => [1])).toEqual({ v: 1, id: 'request-1', ok: true, result: [1] });
		expect(await handleRpc(request, async () => { throw new Error('denied'); })).toEqual({ v: 1, id: 'request-1', ok: false, error: 'denied' });
	});
});
