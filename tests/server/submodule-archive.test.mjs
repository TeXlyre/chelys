// tests/server/submodule-archive.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = fs.readFileSync(
	path.join(root, 'scripts/init-submodules.mjs'),
	'utf8',
);
const gitmodules = fs.readFileSync(path.join(root, '.gitmodules'), 'utf8');

function fixture(callback) {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'chelys-archive-submodule-'),
	);
	try {
		fs.mkdirSync(path.join(dir, 'scripts'));
		fs.writeFileSync(path.join(dir, 'scripts/init-submodules.mjs'), script);
		fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
		fs.writeFileSync(path.join(dir, '.gitmodules'), gitmodules);
		const bin = path.join(dir, 'bin');
		fs.mkdirSync(bin);
		const log = path.join(dir, 'git.log');
		fs.writeFileSync(
			path.join(bin, 'git'),
			`#!/bin/sh\nprintf '%s\\n' "$*" >> "$CHELYS_TEST_GIT_LOG"\nif [ "$1" = config ]; then\n  echo https://github.com/TeXlyre/texlyre.git\nfi\nif [ "$1" = clone ]; then\n  test -d external || exit 34\n  mkdir -p external/texlyre\nfi\n`,
		);
		fs.chmodSync(path.join(bin, 'git'), 0o755);
		const run = () =>
			execFileSync(
				process.execPath,
				[path.join(dir, 'scripts/init-submodules.mjs')],
				{
					cwd: dir,
					env: {
						...process.env,
						PATH: `${bin}${path.delimiter}${process.env.PATH}`,
						CHELYS_TEST_GIT_LOG: log,
					},
					encoding: 'utf8',
				},
			);
		return callback({ dir, log, run });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test('source archives clone the TeXlyre submodule using sparse checkout', () =>
	fixture(({ log, run }) => {
		run();
		const calls = fs.readFileSync(log, 'utf8');
		assert.match(
			calls,
			/config --file .*\.gitmodules --get submodule\.external\/texlyre\.url/,
		);
		assert.match(
			calls,
			/clone --depth=1 --filter=blob:none --sparse https:\/\/github\.com\/TeXlyre\/texlyre\.git external\/texlyre/,
		);
		assert.match(
			calls,
			/-C external\/texlyre sparse-checkout set src\/services.*extras\/themes/,
		);
	}));

test('git checkouts keep the pinned submodule update path', () =>
	fixture(({ dir, log, run }) => {
		fs.mkdirSync(path.join(dir, '.git'));
		run();
		const calls = fs.readFileSync(log, 'utf8');
		assert.match(calls, /submodule update --init --recursive/);
		assert.doesNotMatch(calls, /clone /);
	}));

test('source archives reuse an existing complete TeXlyre checkout', () =>
	fixture(({ dir, log, run }) => {
		for (const folder of [
			'src/services',
			'src/utils',
			'src/types',
			'src/extensions/yjs',
			'src/components/common',
			'src/styles/shared',
			'src/styles/components',
			'extras/themes',
			'src/chelys',
		]) {
			fs.mkdirSync(path.join(dir, 'external/texlyre', folder), {
				recursive: true,
			});
		}
		assert.match(run(), /already present/);
		assert.equal(fs.existsSync(log), false);
	}));

test('an incomplete checkout is not overwritten', () =>
	fixture(({ dir }) => {
		fs.mkdirSync(path.join(dir, 'external/texlyre'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'external/texlyre/README.txt'),
			'user data',
		);
		const outcome = spawnSync(
			process.execPath,
			[path.join(dir, 'scripts/init-submodules.mjs')],
			{ cwd: dir, encoding: 'utf8' },
		);
		assert.notEqual(outcome.status, 0);
		assert.match(outcome.stderr, /Incomplete TeXlyre checkout/);
		assert.equal(
			fs.readFileSync(path.join(dir, 'external/texlyre/README.txt'), 'utf8'),
			'user data',
		);
	}));


test('existing sparse source archive dependencies can acquire themes without recloning', () =>
 fixture(({ dir, log, run }) => {
  fs.mkdirSync(path.join(dir, 'external/texlyre/.git'), { recursive: true });
  run();
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /sparse-checkout set .*extras\/themes/);
  assert.doesNotMatch(calls, /clone /);
 }));
