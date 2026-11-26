#!/usr/bin/env node
// server/cli.mjs
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
	readAccountState,
	writeAccount,
	clearAccount,
	checkCredentialStore,
	warnCredentialFallback,
} from './credentials.mjs';
import { socketPath, fallbackCredentialPath } from './data.mjs';
import { ownerPreference, setOwnerPreference } from './ownership.mjs';

const usage = `Chelys CLI — one command grammar for local and remote peers

  chelys serve [--detach] [--ws-port PORT]  Headless daemon (WebSocket localhost-only)
  chelys shell                             Interactive CLI attached to daemon
  chelys status                            Local account status
  chelys runtime show                      Local owner preference and runtime status (works offline)
  chelys runtime stop                      Gracefully stop the local backend (desktop may restart it)
  chelys runtime preference [automatic|desktop|headless]  Read/set the preferred owner (works offline)
  chelys machine show                      OS, CPU, memory, disk (remote with --peer)
  chelys login [--username U] [--prf HEX|--prf-file FILE|--generate-prf] [--show-prf] [--password-stdin|--password-env NAME]
  chelys logout
  chelys --open-texlyre                    Print a TeXlyre login link and wait for a connected TeXlyre WebRTC peer
  chelys credentials check                     Show active credential backend and auto-migrate if possible
  chelys account show
  chelys settings {list|get KEY|set KEY JSON|delete KEY}       Chelys instance settings
  chelys account {settings|properties|records|secrets} {list|get KEY|set KEY JSON|delete KEY}
  chelys account records {append KEY JSON|remove KEY RECORD_ID}       TeXlyre record entries
  chelys profile {show|set name VALUE|update [--username ...] [--prf HEX|--prf-file FILE|--generate-prf]|rotate-prf}
  chelys recipes {list|registry|add ID [--version VERSION]|inspect ID|connection ID|logs ID|import FILE|remove ID}
  chelys recipes metrics ID [--fields cpu,memory,gpu]   On-demand recipe inspection
  chelys recipes share ID {show|set MODE --fields ...}  Local-only sharing policy
  chelys recipes {install ID MODE [--source registry|build] [--engine docker|podman]|uninstall ID|run ID|stop ID|restart ID|check ID|cancel ID}
  chelys recipes set ID FIELD JSON          Fields: name, notes, cwd, typeConfig.KEY, variableValues.KEY
  chelys recipes env {list ID|get ID KEY|set ID KEY VALUE|delete ID KEY}
  chelys access {show|mode disabled|mode peers|mode keys}
  chelys access keys {list|create NAME PERMISSION[,PERMISSION...] [--fields cpu,memory]|invitation ID|revoke ID}
  chelys peers {list|connect ALIAS INVITATION_OR_WS_URL|disconnect ALIAS|inspect TARGET}
  chelys peers use TARGET                   Select default remote target ("local" clears)

  PRF: chelys --show-prf                  Display the saved local login PRF
       chelys profile show --show-prf     Display the profile and saved PRF
  Global: --peer TARGET  --api-key-env NAME  --json  --reveal  --local
  Storage: JSON values parse as JSON; non-JSON arguments remain strings.
  Use "-" instead of VALUE to read a value from stdin without shell-history exposure.
  Sensitive secrets are redacted by default; --reveal explicitly prints them.
  Native OS keychain is preferred; when unavailable, private account.json is used with a warning.
  Fallback credentials are automatically migrated to the keychain when it recovers.
  Use --password-stdin or --password-env with a secret manager in automation.

Examples:
  chelys login --username alice --generate-prf
  chelys login --username alice --prf-file ~/chelys-prf.txt
  chelys recipes install garage-storage docker --source registry --engine podman --initialize-volumes
  printf '%s' "$SECRET" | chelys account secrets set plugin:global:token -
  chelys access keys create automation recipes.read,recipes.run
  chelys --peer remote-machine --api-key-env CHELYS_REMOTE_KEY recipes list
  chelys runtime preference automatic      Recover a desktop-only profile without opening the UI
`;
const rpc = (method, params = {}) => ({
	v: 1,
	id: crypto.randomUUID(),
	method,
	params,
});
function parseOptions(argv) {
	const options = {};
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('--')) {
			positional.push(token);
			continue;
		}
		const name = token.slice(2);
		if (
			[
				'detach',
				'json',
				'reveal',
				'password-stdin',
				'initialize-volumes',
				'help',
				'local',
				'generate-prf',
				'show-prf',
				'open-texlyre',
			].includes(name)
		)
			options[name] = true;
		else {
			if (!argv[i + 1]) throw new Error(`Missing value for --${name}`);
			options[name] = argv[++i];
		}
	}
	return { positional, options };
}
function readRawValue(raw) {
	if (raw === undefined) throw new Error('Value required');
	return raw === '-' ? fs.readFileSync(0, 'utf8').trimEnd() : raw;
}
function readValue(raw) {
	if (raw === '-') raw = fs.readFileSync(0, 'utf8').trimEnd();
	if (raw === undefined) throw new Error('Value required');
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}
function keyFile(file) {
	return fs.readFileSync(file, 'utf8').trim();
}
function resolvePrf(options, useEnvironment = false) {
	if (options['generate-prf']) {
		if (options.prf !== undefined || options['prf-file'] !== undefined) {
			throw new Error(
				'--generate-prf cannot be combined with --prf or --prf-file',
			);
		}
		return randomBytes(32).toString('hex');
	}
	return (
		options.prf ??
		(options['prf-file']
			? keyFile(options['prf-file'])
			: useEnvironment
				? process.env.CHELYS_PRF
				: undefined)
	);
}
async function savedPrf() {
	const { credentials, storage } = await readAccountState();
	warnCredentialFallback(storage);
	if (!credentials) throw new Error('No saved login. Run chelys login first.');
	return credentials.prf_output_hex;
}
async function openTexlyre(options) {
	if (options.peer || options['show-prf'])
		throw new Error(
			'--open-texlyre is local-only and cannot be combined with --peer or --show-prf',
		);
	if (options.json)
		throw new Error(
			'--open-texlyre is an interactive command and does not support --json',
		);
	let account;
	try {
		account = await send(rpc('account.status'));
	} catch (error) {
		if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
			throw new Error('Chelys is not running. Start chelys serve first.');
		}
		throw error;
	}
	if (!account?.loggedIn)
		throw new Error('Login required. Run chelys login first.');
	const { credentials, storage } = await readAccountState();
	warnCredentialFallback(storage);
	if (!credentials || credentials.username !== account.username) {
		throw new Error('Saved login does not match the active Chelys account');
	}
	const base = await send(
		rpc('chelys.settings.get', { key: 'texlyreBaseUrl' }),
	);
	if (typeof base !== 'string' || !base.trim())
		throw new Error('Configure texlyreBaseUrl in Chelys settings');
	const trimmed = base.trim().replace(/\/+$/, '');
	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error('Invalid texlyreBaseUrl setting');
	}
	if (
		!['https:', 'http:'].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password ||
		parsed.hash ||
		parsed.search
	) {
		throw new Error(
			'texlyreBaseUrl must be an HTTP(S) URL without credentials, query, or fragment',
		);
	}
	const link = `${trimmed}/#tempPrf:${credentials.prf_output_hex}`;
	console.log('TeXlyre session link (Ctrl+click to open):');
	console.log(link);
	console.log('This link contains your PRF; keep it private.');
	console.log(
		'Waiting for a connected TeXlyre WebRTC peer (Ctrl+C to stop)...',
	);
	for (;;) {
		const current = await send(rpc('account.status'));
		if (!current?.loggedIn || current.accountId !== account.accountId) {
			throw new Error('Chelys account changed while waiting for TeXlyre');
		}
		const peers = await send(rpc('account.texlyre.peers'));
		if (!Array.isArray(peers)) throw new Error('Invalid TeXlyre peer status');
		if (peers.length > 0) {
			console.log(
				`TeXlyre WebRTC connected${peers[0].username ? `: ${peers[0].username}` : ''}`,
			);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
}

async function secretPrompt(prompt) {
	if (!process.stdin.isTTY)
		throw new Error(
			'Pass --password-stdin or --password-env for non-interactive login',
		);
	return new Promise((resolve, reject) => {
		const input = process.stdin;
		let text = '';
		process.stdout.write(prompt);
		input.setRawMode(true);
		input.resume();
		input.setEncoding('utf8');
		function finish(error) {
			input.off('data', onData);
			input.setRawMode(false);
			input.pause();
			process.stdout.write('\n');
			if (error) reject(error);
			else resolve(text);
		}
		function onData(value) {
			for (const character of value) {
				if (character === '\r' || character === '\n') {
					finish();
					return;
				}
				if (character === '\u0003') {
					finish(new Error('Cancelled'));
					return;
				}
				if (character === '\u007f') {
					text = text.slice(0, -1);
					continue;
				}
				text += character;
			}
		}
		input.on('data', onData);
	});
}
async function send(request, timeoutMs = ['recipes.install','recipes.uninstall','recipes.run','recipes.restart','recipes.stop','recipes.remove'].includes(request.method === 'peers.call' ? request.params?.method : request.method) ? 30 * 60_000 + 60_000 : 35_000) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		let buffer = '';
		const timeout = setTimeout(() => {
			socket.destroy();
			reject(new Error('Chelys daemon timeout'));
		}, timeoutMs);
		let settled = false;
		function finish(error, response) {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.destroy();
			if (error) reject(error);
			else resolve(response);
		}
		socket.once('error', (error) => finish(error));
		socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on('data', (data) => {
			buffer += data;
			const end = buffer.indexOf('\n');
			if (end < 0) return;
			try {
				const response = JSON.parse(buffer.slice(0, end));
				if (response.id !== request.id || response.v !== 1)
					throw new Error('Invalid daemon response');
				finish(
					response.ok ? null : new Error(response.error || 'Command failed'),
					response.result,
				);
			} catch (error) {
				finish(error);
			}
		});
	});
}
function decode(positional, options) {
	const [group, sub, third, fourth, fifth] = positional;
	const val = (index) => positional[index];
	switch (group) {
		case 'status':
			return rpc('account.status');
		case 'runtime':
			if (sub === 'show') return rpc('instance.runtime');
			break;
		case 'machine':
			if (sub === 'show') return rpc('machine.inspect');
			break;
		case 'logout':
			return rpc('account.logout');
		case 'settings': {
			if (sub === 'list') return rpc('chelys.settings.list');
			if (sub === 'get') return rpc('chelys.settings.get', { key: third });
			if (sub === 'set')
				return rpc('chelys.settings.set', {
					key: third,
					value: readValue(fourth),
				});
			if (sub === 'delete')
				return rpc('chelys.settings.delete', { key: third });
			break;
		}
		case 'account': {
			if (sub === 'show') return rpc('account.status');
			if (!['settings', 'properties', 'records', 'secrets'].includes(sub))
				break;
			if (third === 'list') return rpc('account.store.list', { store: sub });
			if (third === 'get')
				return rpc(
					sub === 'secrets' ? 'account.secret.get' : 'account.store.get',
					{ store: sub, key: fourth },
				);
			if (third === 'set')
				return rpc(
					sub === 'secrets' ? 'account.secret.set' : 'account.store.set',
					{
						store: sub,
						key: fourth,
						value: sub === 'secrets' ? readRawValue(fifth) : readValue(fifth),
					},
				);
			if (third === 'delete')
				return rpc('account.store.delete', { store: sub, key: fourth });
			if (sub === 'records' && third === 'append')
				return rpc('account.store.append', {
					store: sub,
					key: fourth,
					value: readValue(fifth),
				});
			if (sub === 'records' && third === 'remove')
				return rpc('account.store.removeEntry', {
					store: sub,
					key: fourth,
					recordId: fifth,
				});
			break;
		}
		case 'profile':
			if (sub === 'show') return rpc('profile.show');
			if (sub === 'rotate-prf') return rpc('profile.rotate-prf');
			if (sub === 'set')
				return rpc('profile.set', { field: third, value: fourth });
			break;
		case 'access':
			if (sub === 'show') return rpc('access.show');
			if (sub === 'mode') return rpc('access.mode', { mode: third });
			if (sub === 'keys') {
				if (third === 'list') return rpc('access.keys.list');
				if (third === 'create')
					return rpc('access.keys.create', {
						name: fourth,
						permissions: fifth?.split(','),
						...(options.fields
							? { fields: String(options.fields).split(',').filter(Boolean) }
							: {}),
					});
				if (third === 'invitation')
					return rpc('access.keys.invitation', { id: fourth });
				if (third === 'revoke')
					return rpc('access.keys.revoke', { id: fourth });
			}
			break;
		case 'recipes':
			if (sub === 'list') return rpc('recipes.list');
			if (sub === 'registry') return rpc('recipes.registry.list');
			if (sub === 'add')
				return rpc('recipes.registry.add', {
					id: third,
					...(options.version ? { version: options.version } : {}),
				});
			if (sub === 'inspect') return rpc('recipes.inspect', { id: third });
			if (sub === 'logs') return rpc('recipes.logs', { id: third });
			if (sub === 'metrics')
				return rpc('recipes.metrics', {
					id: third,
					...(options.fields
						? { fields: String(options.fields).split(',').filter(Boolean) }
						: {}),
				});
			if (sub === 'share') {
				if (fourth === 'show') return rpc('recipes.share.show', { id: third });
				if (fourth === 'set')
					return rpc('recipes.share.set', {
						id: third,
						mode: fifth,
						fields: String(options.fields || '')
							.split(',')
							.filter(Boolean),
					});
			}
			if (sub === 'import')
				return rpc('recipes.import', {
					recipe: JSON.parse(fs.readFileSync(third, 'utf8')),
				});
			if (sub === 'remove') return rpc('recipes.remove', { id: third });
			if (sub === 'install')
				return rpc('recipes.install', {
					id: third,
					mode: fourth,
					source: options.source || 'build',
					register: true,
					...(options.version ? { version: options.version } : {}),
					...(options.engine ? { engine: options.engine } : {}),
					initializeVolumes: options['initialize-volumes'] === true,
				});
			if (sub === 'connection') return rpc('recipes.connection', { id: third });
            if (sub === 'check') return rpc('recipes.service.check', { id: third });
            if (sub === 'cancel') return rpc('recipes.cancelInstall', { id: third });
            if (sub === 'uninstall') return rpc('recipes.uninstall', { id: third });
			if (sub === 'run') return rpc('recipes.run', { id: third });
			if (sub === 'stop') return rpc('recipes.stop', { id: third });
			if (sub === 'restart') return rpc('recipes.restart', { id: third });
			if (sub === 'set')
				return rpc('recipes.set', {
					id: third,
					field: fourth,
					value: readValue(fifth),
				});
			if (sub === 'env') {
				if (third === 'list') return rpc('recipes.env.list', { id: fourth });
				if (third === 'get')
					return rpc('recipes.env.get', { id: fourth, key: fifth });
				if (third === 'set')
					return rpc('recipes.env.set', {
						id: fourth,
						key: fifth,
						value: readValue(val(5)),
					});
				if (third === 'delete')
					return rpc('recipes.env.delete', { id: fourth, key: fifth });
			}
			break;
		case 'peers':
			if (sub === 'list') return rpc('peers.list');
			if (sub === 'connect')
				return rpc('peers.connect', { alias: third, url: fourth });
			if (sub === 'disconnect')
				return rpc('peers.disconnect', { alias: third });
			if (sub === 'inspect')
				return rpc('peers.call', {
					target: third,
					method: 'instance.inspect',
					apiKey: options['api-key-env']
						? process.env[options['api-key-env']]
						: process.env.CHELYS_REMOTE_KEY,
				});
			if (sub === 'use') return rpc('peers.default', { target: third });
			break;
	}
	throw new Error('Unknown command; run chelys --help');
}
function hideSensitive(request, result, reveal) {
	if (request.method === 'peers.call')
		return hideSensitive(
			{ method: request.params.method, params: request.params.params ?? {} },
			result,
			reveal,
		);
	if (reveal) return result;
	if (request.method === 'account.secret.get')
		return '<secret hidden; use --reveal>';
	if (request.method === 'account.secret.set') return result;
	if (request.method === 'recipes.env.get')
		return '<value hidden; use --reveal>';
	if (request.method === 'recipes.inspect' && result?.recipe) {
		const recipe = structuredClone(result.recipe);
		recipe.env = Object.fromEntries(
			Object.keys(recipe.env || {}).map((key) => [key, '<redacted>']),
		);
		if (recipe.variableValues)
			recipe.variableValues = Object.fromEntries(
				Object.keys(recipe.variableValues).map((key) => [key, '<redacted>']),
			);
		return { ...result, recipe };
	}
	return result;
}
function splitShell(line) {
	const args = [];
	let word = '';
	let quote = null;
	let active = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '\\' && quote !== "'" && i + 1 < line.length) {
			word += line[++i];
			active = true;
		} else if (quote) {
			if (char === quote) quote = null;
			else word += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			active = true;
		} else if (/\s/.test(char)) {
			if (active) {
				args.push(word);
				word = '';
				active = false;
			}
		} else {
			word += char;
			active = true;
		}
	}
	if (quote) throw new Error('Unclosed quotation mark');
	if (active) args.push(word);
	return args;
}
async function login(options) {
	const username = options.username || process.env.CHELYS_USERNAME;
	const prf_output_hex = resolvePrf(options, true);
	const password = options['password-env']
		? process.env[options['password-env']]
		: options['password-stdin']
			? fs.readFileSync(0, 'utf8').trimEnd()
			: await secretPrompt('Password: ');
	if (!username || !password || !prf_output_hex)
		throw new Error('Username, PRF and password are required');
	if (!/^(?:[a-f0-9]{2})+$/i.test(prf_output_hex))
		throw new Error('PRF must be hexadecimal bytes');
	const creds = { username, password, prf_output_hex };
	try {
		return await send(rpc('account.login', creds));
	} catch (error) {
		if (error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED') throw error;
		const storage = await writeAccount(creds);
		return {
			stored: true,
			credentialStorage: storage,
			message: 'Credentials saved. Run chelys serve to connect.',
		};
	}
}
async function profileUpdate(options) {
	const changes = {};
	if (options.username) changes.username = options.username;
	const prf = resolvePrf(options);
	if (prf !== undefined) changes.prf_output_hex = prf;
	if (options['password-env'])
		changes.password = process.env[options['password-env']];
	if (options['password-stdin'])
		changes.password = fs.readFileSync(0, 'utf8').trimEnd();
	if (Object.keys(changes).length === 0)
		throw new Error('Specify at least one credential to update');
	return rpc('profile.update', changes);
}
async function credentialsCommand(action) {
	if (action !== 'check')
		throw new Error(
			'Unknown credentials command; use chelys credentials check',
		);

	const result = await checkCredentialStore();
	warnCredentialFallback(result);
	return {
		...result,
		fallbackFilePresent: fs.existsSync(fallbackCredentialPath()),
	};
}

async function command(argv) {
	const { positional, options } = parseOptions(argv);
	const [primary] = positional;
	if (options['open-texlyre']) {
		if (primary || options.help)
			throw new Error('Use chelys --open-texlyre without another command');
		await openTexlyre(options);
		return;
	}
	if (!primary && options['show-prf'] && !options.help) {
		const prf_output_hex = await savedPrf();
		console.log(
			options.json ? JSON.stringify({ prf_output_hex }) : prf_output_hex,
		);
		return;
	}
	if (!primary || primary === 'help' || options.help) {
		process.stdout.write(usage);
		return;
	}
	const profileAction = primary === 'profile' ? positional[1] : null;
	if (
		options['generate-prf'] &&
		!(
			primary === 'login' ||
			(primary === 'profile' && profileAction === 'update')
		)
	) {
		throw new Error(
			'--generate-prf is supported only by login and profile update',
		);
	}
	if (
		options['show-prf'] &&
		!(
			primary === 'login' ||
			primary === 'status' ||
			(primary === 'account' && positional[1] === 'show') ||
			(primary === 'profile' &&
				['show', 'update', 'rotate-prf'].includes(profileAction))
		)
	) {
		throw new Error(
			'--show-prf is supported by login, status, account show, and profile commands',
		);
	}
	if (
		fs.existsSync(fallbackCredentialPath()) &&
		!['credentials', 'login', 'logout', 'status'].includes(primary)
	) {
		console.warn(
			'[Chelys] SECURITY WARNING: account.json fallback exists. It may contain plaintext login credentials; Chelys will automatically migrate and remove it when the OS keyring is available.',
		);
	}
	if (primary === 'runtime' && positional[1] === 'stop') {
		if (options.peer || positional.length !== 2)
			throw new Error('Use chelys runtime stop (local-only)');
		const result = await send(rpc('instance.shutdown')).catch((error) => {
			if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')
				return { stopping: false, message: 'Backend already stopped' };
			throw error;
		});
		console.log(options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
		return;
	}
	if (primary === 'runtime' && positional[1] === 'show') {
		if (options.peer || positional.length !== 2)
			throw new Error('Use chelys runtime show (local-only)');
		const active = await send(rpc('instance.runtime'), 600).catch((error) => {
			if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')
				return null;
			throw error;
		});
		const result = {
			preference: ownerPreference(),
			status: active ? 'running' : 'stopped',
			kind: active?.kind ?? null,
			pid: active?.pid ?? null,
		};
		console.log(options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
		return;
	}
	if (primary === 'runtime' && positional[1] === 'preference') {
		if (options.peer)
			throw new Error('Runtime ownership preference is local-only');
		const mode = positional[2];
		if (positional.length > 3)
			throw new Error(
				'Use chelys runtime preference [automatic|desktop|headless]',
			);
		if (mode) await setOwnerPreference(mode);
		const result = {
			preference: ownerPreference(),
			...(mode
				? {
						message:
							'Preference saved. Restart the active instance to switch owners.',
					}
				: {}),
		};
		console.log(
			options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2),
		);
		return;
	}
	if (primary === 'serve') {
		if (ownerPreference() === 'desktop' && (process.env.CHELYS_DESKTOP_MANAGED !== '1' || options.detach))
			throw new Error(
				'Desktop ownership is selected; open Chelys or run chelys runtime preference automatic to allow headless startup.',
			);
		if (options.detach) {
			const running = await send(rpc('instance.runtime'), 600).catch(
				() => null,
			);
			if (running)
				throw new Error(
					`Profile is already owned by ${running.kind}; not starting a second runtime`,
				);
			const args = [fileURLToPath(import.meta.url), 'serve'];
			if (options['ws-port']) args.push('--ws-port', options['ws-port']);
			const child = spawn(process.execPath, args, {
				detached: true,
				stdio: 'ignore',
				env: process.env,
			});
			let failure = null;
			child.on('exit', (code, signal) => {
				failure = `Headless daemon exited: ${signal || code}`;
			});
			child.unref();
			const deadline = Date.now() + 12_000;
			while (Date.now() < deadline) {
				if (failure) throw new Error(failure);
				const active = await send(rpc('instance.runtime'), 600).catch(
					() => null,
				);
				if (active?.kind === 'headless' && active.pid === child.pid) {
					console.log(`Chelys daemon ready (PID ${child.pid})`);
					return;
				}
				if (active)
					throw new Error(`Another ${active.kind} runtime owns the profile`);
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			throw new Error(
				'Headless daemon did not become ready. Check its startup log or run chelys serve in the foreground.',
			);
		}
		const { runServer } = await import('./daemon.mjs');
		await runServer({ wsPort: Number(options['ws-port'] || 0) });
		return;
	}
	if (primary === 'credentials') {
		const result = await credentialsCommand(positional[1]);
		console.log(JSON.stringify(result, null, 2));
		return;
	}
	if (primary === 'shell') {
		console.log('Chelys shell. Commands omit "chelys". Use exit to leave.');
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: 'chelys> ',
		});
		rl.prompt();
		for await (const line of rl) {
			const parts = splitShell(line.trim());
			if (parts[0] === 'exit' || parts[0] === 'quit') break;
			if (parts.length)
				try {
					await command(parts);
				} catch (error) {
					console.error('Error:', error.message);
				}
			rl.prompt();
		}
		rl.close();
		return;
	}
	let request =
		primary === 'login'
			? null
			: primary === 'profile' && positional[1] === 'update'
				? await profileUpdate(options)
				: decode(positional, options);
	const credentialCommand =
		primary === 'login' ||
		(primary === 'profile' && ['update', 'rotate-prf'].includes(profileAction));
	if ((credentialCommand || primary === 'runtime') && options.peer)
		throw new Error('This operation is local-only');
	const defaultPeer =
		!credentialCommand &&
		!options.local &&
		!options.peer &&
		primary !== 'peers' &&
		primary !== 'runtime'
			? await send(rpc('peers.default.get')).then(
					(value) => value?.target,
					() => null,
				)
			: null;
	const selected =
		credentialCommand || primary === 'runtime' || options.local
			? null
			: options.peer || process.env.CHELYS_PEER || defaultPeer;
	if (selected && options['show-prf']) {
		throw new Error(
			'Credential and PRF operations are local-only; use --local',
		);
	}
	if (selected && request) {
		const apiKey = options['api-key-env']
			? process.env[options['api-key-env']]
			: process.env.CHELYS_REMOTE_KEY;
		request = rpc('peers.call', {
			target: selected,
			method: request.method,
			params: request.params,
			apiKey,
		});
	}
	let result;
	if (primary === 'login') {
		result = await login(options);
		if (result?.credentialStorage)
			warnCredentialFallback(result.credentialStorage);
	} else {
		try {
			result = await send(request);
		} catch (error) {
			if (
				primary !== 'logout' ||
				(error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED')
			)
				throw error;
			const storage = await clearAccount();
			result = {
				loggedIn: false,
				credentialStorage: storage,
				message: 'Saved credentials cleared; daemon is not running.',
			};
		}
	}
	if (result?.credentialStorage && primary !== 'login')
		warnCredentialFallback(result.credentialStorage);
	if (options['show-prf']) {
		const prf_output_hex = await savedPrf();
		result = {
			...(result && typeof result === 'object' ? result : { result }),
			prf_output_hex,
		};
	}
	const safe = request
		? hideSensitive(request, result, options.reveal)
		: result;
	console.log(
		options.json
			? JSON.stringify(safe)
			: typeof safe === 'string'
				? safe
				: JSON.stringify(safe, null, 2),
	);
}
command(process.argv.slice(2)).catch((error) => {
	console.error('Chelys:', error.message);
	process.exitCode = 1;
});
