// tests/server/rpc-socket.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createLocalServer } from '../../server/rpc-socket.mjs';

test('disconnected RPC client cannot crash the server or prevent subsequent requests', async () => {
	let release, started;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const entered = new Promise((resolve) => {
		started = resolve;
	});
	const server = createLocalServer(async (message) => {
		if (message === 'slow') {
			started();
			await pending;
		}
		return { ok: true, result: message };
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const connect = () => net.connect(server.address().port, '127.0.0.1');
	try {
		const client = connect();
		await once(client, 'connect');
		client.write('slow\n');
		await entered;
		client.destroy();
		await once(client, 'close');
		release();
		const next = connect();
		let result = '';
		next.setEncoding('utf8');
		next.on('data', (chunk) => {
			result += chunk;
		});
		await once(next, 'connect');
		next.write('next\n');
		await once(next, 'end');
		assert.deepEqual(JSON.parse(result), { ok: true, result: 'next' });
	} finally {
		release();
		await new Promise((resolve) => server.close(resolve));
	}
});

test('socket EPIPE is handled even when emitted asynchronously', async () => {
	const server = createLocalServer(async () => ({ ok: true }));
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const accepted = once(server, 'connection');
	const client = net.connect(server.address().port, '127.0.0.1');
	const [socket] = await accepted;
	socket.destroy(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
	await new Promise((resolve) => socket.once('close', resolve));
	client.destroy();
	await new Promise((resolve) => server.close(resolve));
});
