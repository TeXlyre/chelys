// server/adapters/core.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { emit } from './events.mjs';
import { dataDir } from '../data.mjs';
import {
	readAccountState,
	writeAccount,
	clearAccount,
} from '../credentials.mjs';

const children = new Map();
let routeServer = null;
let routeInfo = null;
let routeConfig = { http: { services: {} } };
const endStatus = (handleId, code, signal) =>
	emit('process-status', {
		handleId,
		status: code === 0 ? 'exited' : 'failed',
		exitCode: code ?? (signal ? -1 : null),
	});
function startChild(handleId, spec) {
	if (children.has(handleId))
		throw new Error(`Process already running: ${handleId}`);
	if (!spec || typeof spec.command !== 'string' || !Array.isArray(spec.args))
		throw new Error('Invalid command spec');
	const child = spawn(spec.command, spec.args, {
		cwd: spec.cwd || undefined,
		env: { ...process.env, ...(spec.env || {}) },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.set(handleId, child);
	const forwardLines = (stream, readable) => {
		if (!readable) return;
		let pending = '';
		let discard = false;
		readable.setEncoding('utf8');
		readable.on('data', (text) => {
			for (const character of text) {
				if (character === '\n') {
					if (!discard && pending)
						emit('process-output', {
							handleId,
							stream,
							line: pending.replace(/\r$/, ''),
						});
					pending = '';
					discard = false;
				} else if (!discard) {
					pending += character;
					if (pending.length > 65_536) {
						pending = '';
						discard = true;
					}
				}
			}
		});
		readable.on('end', () => {
			if (!discard && pending)
				emit('process-output', {
					handleId,
					stream,
					line: pending.replace(/\r$/, ''),
				});
		});
	};
	forwardLines('stdout', child.stdout);
	forwardLines('stderr', child.stderr);
	child.once('close', (code, signal) => {
		if (children.get(handleId) === child) children.delete(handleId);
		endStatus(handleId, code, signal);
	});
	return child;
}
async function spawnReady(child) {
	return new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('spawn', () => resolve());
	});
}
async function stopChild(handleId) {
	const child = children.get(handleId);
	if (!child) return;
	children.delete(handleId);
	if (child.exitCode === null) child.kill('SIGTERM');
	await Promise.race([
		new Promise((resolve) => child.once('close', resolve)),
		new Promise((resolve) =>
			setTimeout(() => {
				if (child.exitCode === null) child.kill('SIGKILL');
				resolve();
			}, 4000),
		),
	]);
	emit('process-status', { handleId, status: 'stopped', exitCode: null });
}
export async function stopAllProcesses() {
	await Promise.allSettled([...children.keys()].map(stopChild));
	if (routeServer) await new Promise((resolve) => routeServer.close(resolve));
	routeServer = null;
	routeInfo = null;
}
async function freePort(preferred, fallback) {
	const tryBind = (port) =>
		new Promise((resolve, reject) => {
			const server = net.createServer();
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => {
				const actual = server.address().port;
				server.close(() => resolve(actual));
			});
		});
	try {
		return await tryBind(preferred);
	} catch {
		return fallback ? tryBind(0) : 0;
	}
}
async function startRoutes(port, fallback) {
	if (routeInfo) return routeInfo;
	const token = randomUUID();
	const server = http.createServer((req, res) => {
		if (req.url !== `/${token}`) {
			res.writeHead(404);
			res.end();
			return;
		}
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify(routeConfig));
	});
	try {
		const selected = await freePort(port, fallback);
		if (!selected) throw new Error('Route port unavailable');
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(selected, '127.0.0.1', resolve);
		});
		routeServer = server;
		routeInfo = { token, port: selected };
		return routeInfo;
	} catch (error) {
		try {
			server.close();
		} catch {}
		throw error;
	}
}

export async function invoke(command, args = {}) {
	switch (command) {
		case 'load_credentials':
			return readAccountState();
		case 'save_credentials':
			return writeAccount({
				username: args.username,
				password: args.password,
				prf_output_hex: args.prfOutputHex,
			});
		case 'clear_credentials':
			return clearAccount();
		case 'instance_data_dir':
			return dataDir;
		case 'path_join':
			return path.join(...args.parts);
		case 'fs_exists':
			return fs.existsSync(args.path);
		case 'fs_read':
			return [...fs.readFileSync(args.path)];
		case 'fs_write':
			fs.mkdirSync(path.dirname(args.path), { recursive: true });
			fs.writeFileSync(args.path, Buffer.from(args.contents));
			return;
		case 'fs_mkdir':
			fs.mkdirSync(args.path, { recursive: true });
			return;
		case 'fs_remove':
			fs.rmSync(args.path, { recursive: true, force: true });
			return;
		case 'fs_rename':
			fs.mkdirSync(path.dirname(args.to), { recursive: true });
			fs.renameSync(args.from, args.to);
			return;
		case 'fs_stat': {
			const stat = fs.statSync(args.path);
			return { is_dir: stat.isDirectory(), size: stat.size };
		}
		case 'generate_peer_id':
			return `peer-${randomUUID().replaceAll('-', '')}`;
		case 'find_free_port':
			return freePort(args.preferred, args.fallback);
		case 'process_list_running':
			return [...children.keys()];
		case 'process_is_running':
			return children.has(args.handleId);
		case 'process_spawn': {
			const child = startChild(args.handleId, args.spec);
			try {
				await spawnReady(child);
			} catch (error) {
				children.delete(args.handleId);
				throw error;
			}
			emit('process-status', {
				handleId: args.handleId,
				status: 'running',
				exitCode: null,
			});
			return;
		}
		case 'process_run_command': {
			const child = startChild(args.handleId, args.spec);
			await spawnReady(child);
			return new Promise((resolve, reject) => {
				child.once('error', reject);
				child.once('close', (code) => resolve(code ?? 1));
			});
		}
		case 'process_stop':
			return stopChild(args.handleId);
		case 'traefik_start_route_server':
			return startRoutes(args.port, args.fallback);
		case 'traefik_set_routes':
			routeConfig = args.config;
			return;
		default:
			throw new Error(
				`Unsupported native method in headless runtime: ${command}`,
			);
	}
}
