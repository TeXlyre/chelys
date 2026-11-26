#!/usr/bin/env node
// scripts/init-submodules.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SUBMODULE_DIR = 'external/texlyre';
const SPARSE_PATHS = [
	'src/services',
	'src/utils',
	'src/types',
	'src/extensions/yjs',
	'src/styles/shared',
	'src/chelys',
];

const git = (...args) =>
	execFileSync('git', args, { cwd: root, stdio: 'inherit' });
const externalPath = path.join(root, SUBMODULE_DIR);

if (existsSync(path.join(root, '.git'))) {
	// Normal Git checkouts retain the exact TeXlyre revision recorded by the submodule.
	git('submodule', 'update', '--init', '--recursive');
	git('-C', SUBMODULE_DIR, 'sparse-checkout', 'set', ...SPARSE_PATHS);
} else if (
	SPARSE_PATHS.every((item) => existsSync(path.join(externalPath, item)))
) {
	console.log('TeXlyre dependency is already present.');
} else {
	// Source ZIPs have no .git metadata. Restore the same sparse dependency from .gitmodules.
	if (existsSync(externalPath) && readdirSync(externalPath).length > 0) {
		throw new Error(
			`Incomplete TeXlyre checkout at ${externalPath}; repair or remove it before retrying.`,
		);
	}
	const url = execFileSync(
		'git',
		[
			'config',
			'--file',
			path.join(root, '.gitmodules'),
			'--get',
			`submodule.${SUBMODULE_DIR}.url`,
		],
		{ cwd: root, encoding: 'utf8' },
	).trim();
	if (!url) throw new Error(`Missing ${SUBMODULE_DIR} URL in .gitmodules`);
	console.log('Restoring TeXlyre dependency from Git (sparse checkout)...');
	mkdirSync(path.dirname(externalPath), { recursive: true });
	git(
		'clone',
		'--depth=1',
		'--filter=blob:none',
		'--sparse',
		url,
		SUBMODULE_DIR,
	);
	git('-C', SUBMODULE_DIR, 'sparse-checkout', 'set', ...SPARSE_PATHS);
}
