// server/ownership.mjs
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, ensureDataDir, writeJson } from './data.mjs';

const preferenceFile = path.join(dataDir, 'instance-owner.json');
const claimFile = path.join(dataDir, '.instance-startup.lock');
const allowed = new Set(['automatic', 'desktop', 'headless']);

export function ownerPreference() {
	let contents;
	try {
		contents = fs.readFileSync(preferenceFile, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return 'automatic';
		throw error;
	}
	let value;
	try {
		value = JSON.parse(contents);
	} catch {
		throw new Error(
			'Invalid instance-owner.json; correct it before starting Chelys',
		);
	}
	if (!value || !allowed.has(value.mode))
		throw new Error('Invalid profile owner preference in instance-owner.json');
	return value.mode;
}

export async function setOwnerPreference(mode) {
	if (!allowed.has(mode))
		throw new Error('Owner must be automatic, desktop, or headless');
	await withStartupClaim(() => {
		writeJson(preferenceFile, { mode });
	});
	return mode;
}

// The short-lived claim serializes socket probing/binding across desktop and headless.
// Once bound, the operating-system socket/pipe is the lifetime ownership marker.
export async function withStartupClaim(callback) {
	ensureDataDir();
	const deadline = Date.now() + 35_000;
	let handle;
	for (;;) {
		try {
			handle = fs.openSync(claimFile, 'wx', 0o600);
			try {
				fs.writeSync(handle, `${process.pid}\n`);
			} catch (error) {
				fs.closeSync(handle);
				try {
					fs.unlinkSync(claimFile);
				} catch {}
				throw error;
			}
			break;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			let stale = false;
			try {
				const stats = fs.statSync(claimFile);
				const age = Date.now() - stats.mtimeMs;
				stale = age > 30_000;
				if (!stale && age > 1_000) {
					const pid = Number(fs.readFileSync(claimFile, 'utf8').trim());
					if (Number.isSafeInteger(pid) && pid > 0) {
						try {
							process.kill(pid, 0);
						} catch (error) {
							if (error.code === 'ESRCH') stale = true;
						}
					}
				}
			} catch (statError) {
				if (statError.code !== 'ENOENT') throw statError;
			}
			if (stale) {
				try {
					fs.unlinkSync(claimFile);
				} catch (unlinkError) {
					if (unlinkError.code !== 'ENOENT') throw unlinkError;
				}
				continue;
			}
			if (Date.now() >= deadline)
				throw new Error(
					'Chelys profile startup is locked; wait for the other instance to finish starting',
				);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	try {
		return await callback();
	} finally {
		fs.closeSync(handle);
		try {
			fs.unlinkSync(claimFile);
		} catch (error) {
			if (error.code !== 'ENOENT')
				console.error('[Chelys] Failed to clear startup lock:', error);
		}
	}
}
