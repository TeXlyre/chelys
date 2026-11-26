// server/daemon.mjs
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { bootstrapHeadless, setSignalingOrigin } from './boot.mjs';
import {
	socketPath,
	activeRecipes,
	saveActiveRecipes,
	ensureDataDir,
	dataDir,
	hasPersistentStorage,
} from './data.mjs';
import {
	readAccountState,
	writeAccount,
	clearAccount,
	warnCredentialFallback,
} from './credentials.mjs';
import { stopAllProcesses } from './adapters/core.mjs';
import { ownerPreference, withStartupClaim } from './ownership.mjs';

const MAX_REQUEST = 2_097_152;
const MAX_RESPONSE = 8_388_608;
const MAX_REMOTE_REQUEST = 65_536;

async function reserveSocket() {
	if (process.platform !== 'win32' && !fs.existsSync(socketPath)) return;
	const error = await new Promise((resolve) => {
		const probe = net.connect(socketPath);
		probe.once('connect', () => {
			probe.destroy();
			resolve(
				new Error('A Chelys daemon is already using this data directory'),
			);
		});
		probe.once('error', resolve);
	});
	if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOENT') {
		if (process.platform !== 'win32') fs.unlinkSync(socketPath);
	} else throw error;
}
function writeResponse(socket, response, suffix = '\n') {
	const data = JSON.stringify(response);
	if (data.length > MAX_RESPONSE) {
		const small = JSON.stringify({
			v: 1,
			id: response.id,
			ok: false,
			error: 'Response exceeds limit',
		});
		if (typeof socket.write === 'function') socket.write(small + suffix);
		else socket.send(small);
	} else if (typeof socket.write === 'function') socket.write(data + suffix);
	else socket.send(data);
}

export async function runServer({ wsPort = 0 } = {}) {
	ensureDataDir();
	const desktopManaged = process.env.CHELYS_DESKTOP_MANAGED === '1';
	const desktopPid = Number(process.env.CHELYS_DESKTOP_PID);
	if (desktopManaged && (!Number.isSafeInteger(desktopPid) || desktopPid <= 0))
		throw new Error('Desktop-managed backend requires a valid desktop process ID');
	if (desktopManaged && ownerPreference() !== 'desktop')
		throw new Error('Desktop ownership preference changed while launching the backend; retry');
	if (
		ownerPreference() === 'desktop' &&
		!desktopManaged
	)
		throw new Error(
			'This profile prefers Desktop ownership. Start the desktop application, or change the owner in Settings.',
		);
	let execute = async () => ({
		v: 1,
		id: 'initializing',
		ok: false,
		error: 'Chelys is starting',
	});
	const local = net.createServer((socket) => {
		let buffer = '';
		socket.setEncoding('utf8');
		socket.on('data', (chunk) => {
			buffer += chunk;
			if (buffer.length > MAX_REQUEST) {
				socket.destroy();
				return;
			}
			const newline = buffer.indexOf('\n');
			if (newline < 0) return;
			const message = buffer.slice(0, newline);
			buffer = '';
			void execute(message, { transport: 'local' }).then((response) => {
				writeResponse(socket, response);
				socket.end();
			});
		});
	});
	await withStartupClaim(async () => {
		const preferred = ownerPreference();
		if (preferred === 'desktop' && !desktopManaged)
			throw new Error('Desktop ownership was selected while starting Chelys');
		if (desktopManaged && preferred !== 'desktop')
			throw new Error('Desktop ownership preference changed during startup; retry');
		await reserveSocket();
		await new Promise((resolve, reject) => {
			local.once('error', reject);
			local.listen(socketPath, resolve);
		});
		if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600);
	});
	try {
		bootstrapHeadless();
		const {
			chelysControl,
			recipeManager,
			initializeChelysRecipes,
			activateCredentials,
			stopAccountConnection,
			bridgeRegistry,
			rendezvousPresence,
			handleRpc,
			getStoredSetting,
		} = await import('./dist/runtime.mjs');
		setSignalingOrigin(() => getStoredSetting('headlessSignalingOrigin'));
		chelysControl.setRuntimeKind(desktopManaged ? 'desktop' : 'headless', process.pid);
		chelysControl.setStorageSeedAllowed(!hasPersistentStorage());
		await initializeChelysRecipes();
		const unsubscribePresence = recipeManager.subscribe((statuses) =>
			rendezvousPresence.prune((id) => statuses.get(id)?.state === 'running'),
		);
		let session = null;
		let currentCredentials = null;
		let credentialStorage = null;
		const desired = activeRecipes();
		chelysControl.setRecipeCommandListener((method, id) => {
			if (method === 'recipes.run' || method === 'recipes.restart')
				desired.add(id);
			if (
				['recipes.stop', 'recipes.uninstall', 'recipes.remove'].includes(method)
			)
				desired.delete(id);
			saveActiveRecipes(desired);
		});
		chelysControl.setMachineInfo(async () => {
			let freeStorageBytes = null;
			let totalStorageBytes = null;
			try {
				const space = fs.statfsSync(dataDir, { bigint: true });
				freeStorageBytes = String(space.bavail * space.bsize);
				totalStorageBytes = String(space.blocks * space.bsize);
			} catch {}
			return {
				platform: process.platform,
				architecture: process.arch,
				hostname: os.hostname(),
				cpus: os.availableParallelism(),
				memoryBytes: String(os.totalmem()),
				freeMemoryBytes: String(os.freemem()),
				freeStorageBytes,
				totalStorageBytes,
			};
		});
		// Account room transitions remain on the authoritative service, never in the renderer.
		const migrateRoomData = (username, roomId) => {
			const previous = globalThis.localStorage.getItem(
				`chelys-last-room:${username}`,
			);
			if (previous && previous !== roomId) {
				const prefix = `texlyre-user-${previous}-`;
				for (
					let index = globalThis.localStorage.length - 1;
					index >= 0;
					index--
				) {
					const name = globalThis.localStorage.key(index);
					if (!name?.startsWith(prefix)) continue;
					const target = `texlyre-user-${roomId}-${name.slice(prefix.length)}`;
					if (globalThis.localStorage.getItem(target) === null) {
						const value = globalThis.localStorage.getItem(name);
						if (value !== null) globalThis.localStorage.setItem(target, value);
					}
				}
			}
			globalThis.localStorage.setItem(`chelys-last-room:${username}`, roomId);
		};
		chelysControl.setAccountHandlers({
			async login(credentials) {
				const previous = currentCredentials;
				const savedStorage = await writeAccount(credentials);
				credentialStorage = savedStorage;
				warnCredentialFallback(savedStorage);
				try {
					if (session) stopAccountConnection();
					session = null;
					currentCredentials = null;
					session = await activateCredentials(credentials, migrateRoomData);
					currentCredentials = credentials;
					return {
						loggedIn: true,
						username: session.username,
						accountId: session.roomId,
						credentialStorage,
					};
				} catch (error) {
					try {
						credentialStorage = previous
							? await writeAccount(previous)
							: await clearAccount();
						warnCredentialFallback(credentialStorage);
					} catch (rollbackError) {
						throw new AggregateError(
							[error, rollbackError],
							'Account activation and credential rollback both failed',
						);
					}
					if (previous) {
						try {
							session = await activateCredentials(previous);
							currentCredentials = previous;
						} catch (recoveryError) {
							throw new AggregateError(
								[error, recoveryError],
								'Account activation failed; previous connection could not be restored',
							);
						}
					}
					throw error;
				}
			},
			async logout() {
				credentialStorage = await clearAccount();
				warnCredentialFallback(credentialStorage);
				stopAccountConnection();
				session = null;
				currentCredentials = null;
				return { loggedIn: false, credentialStorage };
			},
			password: () => currentCredentials?.password ?? null,
			credentials: () =>
				currentCredentials
					? {
							username: currentCredentials.username,
							prf_output_hex: currentCredentials.prf_output_hex,
						}
					: null,
			async update(changes) {
				if (!currentCredentials) throw new Error('Login required');
				return this.login({
					...currentCredentials,
					...changes,
					...(changes.password
						? { password: changes.password }
						: { password: currentCredentials.password }),
				});
			},
			status: () => ({
				loggedIn: Boolean(session),
				accountId: session?.roomId ?? null,
				username: session?.username ?? null,
				credentialStorage,
			}),
		});

		let credentials;
		try {
			const restored = await readAccountState();
			credentials = restored.credentials;
			credentialStorage = restored.storage;
			warnCredentialFallback(credentialStorage);
		} catch (error) {
			throw new Error(`Chelys cannot read credentials: ${error.message}`);
		}
		if (credentials) {
			try {
				session = await activateCredentials(credentials, migrateRoomData);
				currentCredentials = credentials;
			} catch (error) {
				console.error('[Chelys] Account activation failed:', error.message);
			}
		}
		for (const id of desired) {
			try {
				await chelysControl.execute({ method: 'recipes.run', params: { id } });
			} catch (error) {
				console.error('[Chelys] Could not restore recipe', id, error.message);
			}
		}
		let shutdown = null;
		execute = async (message, origin) => {
			// Local-only process lifecycle control. Never expose this via remote keys.
			if (origin.transport === 'local') {
				let request;
				try { request = JSON.parse(message); } catch {}
				if (request?.v === 1 && typeof request.id === 'string' && request.method === 'instance.shutdown') {
					if (!shutdown) return { v: 1, id: request.id, ok: false, error: 'Backend is still starting' };
					setTimeout(() => { void shutdown().finally(() => process.exit(0)); }, 75).unref();
					return { v: 1, id: request.id, ok: true, result: { stopping: true } };
				}
			}
			return handleRpc(message, (request) =>
				chelysControl.execute(request, { ...origin, apiKey: request.apiKey }),
			);
		};
		let websocket = null;
		if (wsPort) {
			websocket = new WebSocketServer({
				host: '127.0.0.1',
				port: wsPort,
				maxPayload: MAX_REQUEST,
			});
			websocket.on('connection', (socket) => {
				socket.on('message', (payload) => {
					if (payload.length > MAX_REMOTE_REQUEST) {
						socket.close(1009);
						return;
					}
					void execute(payload.toString('utf8'), {
						transport: 'websocket',
					}).then((response) => writeResponse(socket, response, ''));
				});
			});
			await new Promise((resolve, reject) => {
				websocket.once('listening', resolve);
				websocket.once('error', reject);
			});
			console.info(
				`[Chelys] WebSocket control bound to 127.0.0.1:${wsPort} (use a TLS proxy for remote access)`,
			);
		}
		console.info(`[Chelys] ${desktopManaged ? 'Desktop-managed' : 'Headless'} runtime listening on`, socketPath);
		let closing = null;
		let ownerWatch = null;
		shutdown = () => {
			if (closing) return closing;
			if (ownerWatch) clearInterval(ownerWatch);
			closing = (async () => {
				bridgeRegistry.stopAll();
				unsubscribePresence();
				rendezvousPresence.stopAll();
				stopAccountConnection();
				await stopAllProcesses();
				await new Promise((resolve) => local.close(resolve));
				if (websocket) await new Promise((resolve) => websocket.close(resolve));
				if (process.platform !== 'win32') {
					try { fs.unlinkSync(socketPath); } catch {}
				}
			})();
			return closing;
		};
		// Desktop mode is genuinely desktop-owned: if the launcher closes or
		// crashes, shut down the service and managed recipe processes cleanly.
		// Automatic and headless modes deliberately have no parent watcher.
		if (desktopManaged) {
			ownerWatch = setInterval(() => {
				try {
					process.kill(desktopPid, 0);
				} catch (error) {
					if (error.code === 'ESRCH')
						void shutdown().finally(() => process.exit(0));
				}
			}, 1000);
			ownerWatch.unref();
		}
		process.on('SIGINT', () => {
			void shutdown().finally(() => process.exit(0));
		});
		process.on('SIGTERM', () => {
			void shutdown().finally(() => process.exit(0));
		});
		return { shutdown, execute, local, websocket };
	} catch (error) {
		await new Promise((resolve) => local.close(resolve));
		if (process.platform !== 'win32') {
			try {
				fs.unlinkSync(socketPath);
			} catch {}
		}
		throw error;
	}
}
