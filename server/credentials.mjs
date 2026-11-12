// server/credentials.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir } from './data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const binary =
	process.platform === 'win32'
		? 'chelys-credentials.exe'
		: 'chelys-credentials';
const candidates = () => [
	path.join(root, 'server', 'bin', binary),
	path.join(root, 'native', 'credentials', 'target', 'release', binary),
	path.join(root, 'native', 'credentials', 'target', 'debug', binary),
];

export function credentialHelperPath() {
	if (process.env.CHELYS_CREDENTIAL_HELPER) {
		const specified = path.resolve(process.env.CHELYS_CREDENTIAL_HELPER);
		if (!fs.existsSync(specified))
			throw new Error(
				'CHELYS_CREDENTIAL_HELPER does not exist; build the native helper',
			);
		return specified;
	}
	const existing = candidates().find((candidate) => fs.existsSync(candidate));
	if (!existing)
		throw new Error(
			'Native credential helper missing. Run npm run build:credentials (Rust/Cargo required).',
		);
	return existing;
}

async function run(operation, credentials) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(credentialHelperPath(), [operation], {
				stdio: ['pipe', 'pipe', 'pipe'],
				windowsHide: true,
				env: { ...process.env, CHELYS_DATA_DIR: dataDir },
			});
		} catch (error) {
			reject(
				new Error(`Cannot launch native credential helper: ${error.message}`),
			);
			return;
		}
		let stdout = '';
		let stderr = '';
		let finished = false;
		const timeout = setTimeout(() => {
			child.kill();
			finish(
				new Error(
					'Credential helper timed out; check the keychain and native helper',
				),
			);
		}, 90_000);
		function finish(error, value) {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			if (error) reject(error);
			else resolve(value);
		}
		child.on('error', (error) =>
			finish(
				new Error(`Native credential helper failed to start: ${error.message}`),
			),
		);
		child.stdin.on('error', (error) =>
			finish(
				new Error(`Native credential helper rejected input: ${error.message}`),
			),
		);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
			if (stdout.length > 65_536) {
				child.kill();
				finish(new Error('Credential helper response too large'));
			}
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
			if (stderr.length > 4096) {
				child.kill();
				finish(new Error('Credential helper error too large'));
			}
		});
		child.on('close', (code) => {
			if (finished) return;
			if (code !== 0) {
				finish(
					new Error(
						(stderr.trim() || `OS credential helper exited ${code}`).slice(
							0,
							4096,
						),
					),
				);
				return;
			}
			try {
				finish(null, JSON.parse(stdout));
			} catch {
				finish(new Error('Invalid response from native credential helper'));
			}
		});
		if (credentials === undefined) child.stdin.end();
		else child.stdin.end(JSON.stringify(credentials));
	});
}

function validCredentials(value) {
	return (
		value &&
		typeof value.username === 'string' &&
		value.username.trim() &&
		typeof value.password === 'string' &&
		value.password &&
		typeof value.prf_output_hex === 'string' &&
		/^(?:[a-f\d]{2})+$/i.test(value.prf_output_hex)
	);
}

function statusOf(result) {
	const status = result?.storage;
	if (
		!status ||
		!['keyring', 'file'].includes(status.backend) ||
		(status.warning !== null && typeof status.warning !== 'string')
	) {
		throw new Error('Invalid credential storage status from native helper');
	}
	return status;
}

export function warnCredentialFallback(status) {
	if (status?.backend === 'file') {
		console.warn(
			`[Chelys] SECURITY WARNING: ${status.warning || 'Credentials are in plaintext account.json because the OS keyring is unavailable.'}`,
		);
	}
}

export async function readAccountState() {
	const result = await run('get');
	const storage = statusOf(result);
	if (result.credentials !== null && !validCredentials(result.credentials)) {
		throw new Error('Invalid credentials returned by native helper');
	}
	return { credentials: result.credentials, storage };
}

export async function readAccount() {
	return (await readAccountState()).credentials;
}

export async function writeAccount(credentials) {
	if (!validCredentials(credentials))
		throw new Error('Invalid credential payload');
	return statusOf(await run('set', credentials));
}

export async function clearAccount() {
	return statusOf(await run('delete'));
}

export async function checkCredentialStore() {
	const result = await run('check');
	return { ...statusOf(result), stored: result.stored === true };
}
