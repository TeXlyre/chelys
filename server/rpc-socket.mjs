// server/rpc-socket.mjs
import net from 'node:net';

const MAX_REQUEST = 2_097_152;
const MAX_RESPONSE = 8_388_608;

export function encodeResponse(response) {
	const data = JSON.stringify(response);
	return data.length <= MAX_RESPONSE
		? data
		: JSON.stringify({
				v: 1,
				id: response.id,
				ok: false,
				error: 'Response exceeds limit',
			});
}

export function handleSocketError(socket, error) {
	if (!['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes(error.code))
		console.warn('[Chelys] Control socket error:', error.message);
	if (typeof socket.destroy === 'function') socket.destroy();
	else socket.terminate();
}

export function createLocalServer(execute) {
	return net.createServer((socket) => {
		let buffer = '';
		let received = false;
		socket.on('error', (error) => handleSocketError(socket, error));
		socket.setEncoding('utf8');
		socket.on('data', (chunk) => {
			if (received) return;
			buffer += chunk;
			if (buffer.length > MAX_REQUEST) {
				socket.destroy();
				return;
			}
			const newline = buffer.indexOf('\n');
			if (newline < 0) return;
			const message = buffer.slice(0, newline);
			// The protocol supports one request per connection.
			received = true;
			buffer = '';
			void execute(message).then((response) => {
				if (!socket.destroyed && socket.writable && !socket.writableEnded)
					socket.end(`${encodeResponse(response)}\n`);
			});
		});
	});
}
