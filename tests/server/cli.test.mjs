// tests/server/cli.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../server/cli.mjs', import.meta.url));
const run = (args, env) =>
	spawnSync(process.execPath, [cli, ...args], {
		encoding: 'utf8',
		env: { ...process.env, ...env },
		timeout: 10_000,
	});

const helper = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const data = process.env.CHELYS_DATA_DIR;
const id = process.env.CHELYS_CREDENTIAL_ID || 'default';
const fallback = path.join(data, id === 'default' ? 'account.json' : 'account.'+id+'.json');
const keyring = process.env.FAKE_OS_KEYCHAIN_RECORD + '-' + id;
const unavailable = process.env.FAKE_KEYCHAIN_LOCKED === 'yes';
const action = process.argv[2];
const warning = unavailable ? 'OS credential store unavailable (locked); plaintext account.json fallback in use' : null;
const status = (backend, migrated=false) => ({backend, migrated, warning: backend==='file' ? warning || 'Keyring unavailable; plaintext fallback active' : null});
function readFile() {
  if (!fs.existsSync(fallback)) return null;
  const stat = fs.lstatSync(fallback);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsafe account.json');
  const value = JSON.parse(fs.readFileSync(fallback,'utf8'));
  if (value.logged_out === true) return {logout:true};
  if (typeof value.username !== 'string' || typeof value.password !== 'string') throw Error('Invalid fallback credentials');
  return {value};
}
function read() {
  const fallbackEntry = readFile();
  if (fallbackEntry) {
    if (fallbackEntry.logout) {
      if (!unavailable) { fs.rmSync(keyring,{force:true}); fs.rmSync(fallback); return {credentials:null,storage:status('keyring',true)}; }
      return {credentials:null,storage:status('file')};
    }
    if (!unavailable) {
      fs.writeFileSync(keyring, JSON.stringify(fallbackEntry.value));
      const confirmed = JSON.parse(fs.readFileSync(keyring,'utf8'));
      if (JSON.stringify(confirmed)===JSON.stringify(fallbackEntry.value)) fs.rmSync(fallback);
      return {credentials:confirmed,storage:status('keyring',true)};
    }
    return {credentials:fallbackEntry.value,storage:status('file')};
  }
  return unavailable ? {credentials:null,storage:status('file')} :
    {credentials:fs.existsSync(keyring)?JSON.parse(fs.readFileSync(keyring,'utf8')):null,storage:status('keyring')};
}
function save(creds) {
  if (unavailable) {
    fs.writeFileSync(fallback,JSON.stringify(creds),{mode:0o600});
    return status('file');
  }
  fs.writeFileSync(keyring,JSON.stringify(creds),{mode:0o600});
  fs.rmSync(fallback,{force:true});
  return status('keyring');
}
try {
  if (action==='get') console.log(JSON.stringify(read()));
  else if (action==='check') { const v=read();console.log(JSON.stringify({storage:v.storage,stored:!!v.credentials})); }
  else if (action==='set') {
    let body='';process.stdin.on('data',chunk=>body+=chunk);
    process.stdin.on('end',()=>console.log(JSON.stringify({storage:save(JSON.parse(body))})));
  } else if (action==='delete') {
    if (!unavailable) {fs.rmSync(keyring,{force:true});fs.rmSync(fallback,{force:true});console.log(JSON.stringify({storage:status('keyring')}));}
    else {fs.writeFileSync(fallback,JSON.stringify({logged_out:true}),{mode:0o600});console.log(JSON.stringify({storage:status('file')}));}
  } else process.exitCode=2;
} catch(error){console.error(error.message);process.exitCode=1;}
`;

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chelys-native-test-'));
	const dir = path.join(root, 'runtime');
	fs.mkdirSync(dir);
	const executable = path.join(root, 'mock-credential-helper');
	const record = path.join(root, 'mock-keychain');
	fs.writeFileSync(executable, helper, { mode: 0o700 });
	const env = {
		CHELYS_DATA_DIR: dir,
		CHELYS_CREDENTIAL_HELPER: executable,
		FAKE_OS_KEYCHAIN_RECORD: record,
		TEST_PASSWORD: 'test-secret',
	};
	return {
		root,
		dir,
		record: `${record}-default`,
		env,
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}
function login(env) {
	return run(
		[
			'login',
			'--username',
			'demo',
			'--prf',
			'00',
			'--password-env',
			'TEST_PASSWORD',
		],
		env,
	);
}

test('CLI documents the automatic fallback and no manual migration commands', () => {
	const result = run(['--help']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(
		result.stdout,
		/account \{settings\|properties\|records\|secrets\}/,
	);
	assert.match(result.stdout, /credentials check/);
	assert.match(result.stdout, /account.json/);
	assert.doesNotMatch(result.stdout, /migrate-legacy|purge-legacy/);
});

test('keyring login uses the native store and never creates fallback', () => {
	const f = fixture();
	try {
		const result = login(f.env);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(fs.existsSync(path.join(f.dir, 'account.json')), false);
		assert.deepEqual(JSON.parse(fs.readFileSync(f.record, 'utf8')), {
			username: 'demo',
			password: 'test-secret',
			prf_output_hex: '00',
		});
		assert.equal(
			JSON.parse(run(['credentials', 'check'], f.env).stdout).backend,
			'keyring',
		);
		assert.equal(run(['logout'], f.env).status, 0);
		assert.equal(fs.existsSync(f.record), false);
	} finally {
		f.cleanup();
	}
});

test('locked keyring uses private plaintext fallback and warns without leaking password', () => {
	const f = fixture();
	try {
		const r = login({ ...f.env, FAKE_KEYCHAIN_LOCKED: 'yes' });
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stderr, /SECURITY WARNING/);
		assert.doesNotMatch(r.stdout + r.stderr, /test-secret/);
		assert.equal(
			fs.statSync(path.join(f.dir, 'account.json')).mode & 0o777,
			0o600,
		);
		assert.equal(
			JSON.parse(fs.readFileSync(path.join(f.dir, 'account.json'), 'utf8'))
				.password,
			'test-secret',
		);
		const status = run(['credentials', 'check'], {
			...f.env,
			FAKE_KEYCHAIN_LOCKED: 'yes',
		});
		assert.equal(JSON.parse(status.stdout).backend, 'file');
		assert.match(status.stderr, /SECURITY WARNING/);
	} finally {
		f.cleanup();
	}
});

test('keyring recovery automatically verifies and removes fallback on check', () => {
	const f = fixture();
	try {
		assert.equal(login({ ...f.env, FAKE_KEYCHAIN_LOCKED: 'yes' }).status, 0);
		const check = run(['credentials', 'check'], f.env);
		assert.equal(check.status, 0, check.stderr);
		assert.equal(JSON.parse(check.stdout).backend, 'keyring');
		assert.equal(JSON.parse(check.stdout).migrated, true);
		assert.equal(JSON.parse(check.stdout).fallbackFilePresent, false);
		assert.equal(fs.existsSync(path.join(f.dir, 'account.json')), false);
		assert.equal(
			JSON.parse(fs.readFileSync(f.record, 'utf8')).username,
			'demo',
		);
	} finally {
		f.cleanup();
	}
});

test('fallback saved during outage takes precedence over an older keyring entry', () => {
	const f = fixture();
	try {
		fs.writeFileSync(
			f.record,
			JSON.stringify({
				username: 'stale',
				password: 'stale',
				prf_output_hex: 'aa',
			}),
		);
		assert.equal(login({ ...f.env, FAKE_KEYCHAIN_LOCKED: 'yes' }).status, 0);
		assert.equal(run(['credentials', 'check'], f.env).status, 0);
		assert.equal(
			JSON.parse(fs.readFileSync(f.record, 'utf8')).username,
			'demo',
		);
	} finally {
		f.cleanup();
	}
});

test('offline logout while keyring locked leaves a non-secret marker that suppresses stale restoration', () => {
	const f = fixture();
	try {
		assert.equal(login(f.env).status, 0);
		const result = run(['logout'], { ...f.env, FAKE_KEYCHAIN_LOCKED: 'yes' });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, /SECURITY WARNING/);
		assert.deepEqual(
			JSON.parse(fs.readFileSync(path.join(f.dir, 'account.json'), 'utf8')),
			{ logged_out: true },
		);
		const locked = run(['credentials', 'check'], {
			...f.env,
			FAKE_KEYCHAIN_LOCKED: 'yes',
		});
		assert.equal(JSON.parse(locked.stdout).stored, false);
		const recovered = run(['credentials', 'check'], f.env);
		assert.equal(JSON.parse(recovered.stdout).stored, false);
		assert.equal(fs.existsSync(f.record), false);
		assert.equal(fs.existsSync(path.join(f.dir, 'account.json')), false);
	} finally {
		f.cleanup();
	}
});

test('missing native helper is an installation error rather than a silent second implementation', () => {
	const f = fixture();
	try {
		const r = login({
			...f.env,
			CHELYS_CREDENTIAL_HELPER: path.join(f.root, 'missing'),
		});
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /does not exist/);
		assert.equal(fs.existsSync(path.join(f.dir, 'account.json')), false);
	} finally {
		f.cleanup();
	}
});

test('symlink fallback is rejected and outside contents are preserved', () => {
	if (process.platform === 'win32') return;
	const f = fixture();
	try {
		const target = path.join(f.root, 'outside.json');
		fs.writeFileSync(
			target,
			JSON.stringify({
				username: 'outside',
				password: 'secret',
				prf_output_hex: '00',
			}),
		);
		fs.symlinkSync(target, path.join(f.dir, 'account.json'));
		const result = run(['credentials', 'check'], f.env);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Unsafe account.json/);
		assert.equal(fs.existsSync(target), true);
	} finally {
		f.cleanup();
	}
});

test('invalid fallback JSON is not silently discarded', () => {
	const f = fixture();
	try {
		fs.writeFileSync(path.join(f.dir, 'account.json'), '{broken');
		const result = run(['credentials', 'check'], f.env);
		assert.notEqual(result.status, 0);
		assert.equal(
			fs.readFileSync(path.join(f.dir, 'account.json'), 'utf8'),
			'{broken',
		);
	} finally {
		f.cleanup();
	}
});

test('custom credential identifiers use isolated fallback paths', () => {
	const f = fixture();
	try {
		const env = {
			...f.env,
			FAKE_KEYCHAIN_LOCKED: 'yes',
			CHELYS_CREDENTIAL_ID: 'instance-a',
		};
		assert.equal(login(env).status, 0);
		assert.equal(
			fs.existsSync(path.join(f.dir, 'account.instance-a.json')),
			true,
		);
		assert.equal(fs.existsSync(path.join(f.dir, 'account.json')), false);
		assert.equal(
			JSON.parse(run(['credentials', 'check'], env).stdout).backend,
			'file',
		);
	} finally {
		f.cleanup();
	}
});
