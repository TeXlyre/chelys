// tests/server/source-hygiene.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const sourceFiles = function* (directory = root) {
	for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
		if (
			[
				'external',
				'node_modules',
				'dist',
				'release',
				'target',
				'.git',
			].includes(item.name)
		)
			continue;
		const full = path.join(directory, item.name);
		if (item.isDirectory()) yield* sourceFiles(full);
		else if (item.isFile() && /\.(mjs|js|ts|tsx|rs)$/.test(item.name))
			yield full;
	}
};

test('source files have no repeated leading repository-path comment', () => {
	for (const filename of sourceFiles()) {
		const relative = path.relative(root, filename).split(path.sep).join('/');
		const lines = fs.readFileSync(filename, 'utf8').split(/\r?\n/);
		const pathComment = `// ${relative}`;
		const first = lines[0].startsWith('#!') ? 1 : 0;
		assert.notEqual(
			lines[first],
			lines[first + 1],
			`Duplicate leading line in ${relative}`,
		);
		if (lines[first] === pathComment) {
			assert.notEqual(
				lines[first + 1],
				pathComment,
				`Repeated repository header in ${relative}`,
			);
		}
	}
});

test('Biome treats packaged and compiled runtime copies as build products', () => {
	const config = JSON.parse(read('biome.json'));
	for (const expected of [
		'!!release',
		'!!**/dist',
		'!!src-tauri/target',
		'!!native/**/target',
		'!!src-tauri/binaries',
	]) {
		assert.ok(
			config.files.includes.includes(expected),
			`Missing Biome output exclusion ${expected}`,
		);
	}
});

test('peer inventory uses an accessible named section and installed UI buttons have explicit types', () => {
	assert.match(
		read('src/components/profile/PeerControlSection.tsx'),
		/<section\s+className='control-peer-list'\s+aria-label='Discovered and saved Chelys peers'/,
	);
	for (const file of [
		'src/components/app/DashboardApp.tsx',
		'src/components/profile/BackgroundServerSection.tsx',
	]) {
		const text = read(file);
		assert.doesNotMatch(
			text,
			/<button(?!\s+type=)(?=[\s>])/,
			`Missing type on a button in ${file}`,
		);
	}
	assert.match(read('src/contexts/PluginHostContext.tsx'), /'recipes.install'/);
});

test('all UI buttons specify their behavior and imported recipe actions are keyboard accessible', () => {
	for (const filename of sourceFiles(path.join(root, 'src', 'components'))) {
		if (!filename.endsWith('.tsx')) continue;
		const relative = path.relative(root, filename);
		const source = fs.readFileSync(filename, 'utf8');
		for (const match of source.matchAll(/<button\b[^>]*>/g)) {
			assert.match(
				match[0],
				/\btype=['"](?:button|submit|reset)['"]/,
				`Missing explicit button type in ${relative}`,
			);
		}
	}
	const importer = read('src/components/plugin-host/RecipeImport.tsx');
	assert.match(importer, /<label className='import-option-button'>/);
	assert.match(
		importer,
		/<button\s+type='button'\s+className='import-option-button'/,
	);
	assert.doesNotMatch(
		importer,
		/<label\s+className='import-option-button'\s+onClick=/,
	);
	assert.match(
		read('src/components/settings/SettingControl.tsx'),
		/<label htmlFor={controlId}>/,
	);
	assert.match(
		read('src/components/plugin-host/RecipeVariables.tsx'),
		/<label htmlFor={\x60\$\{fieldPrefix\}-\$\{variable.key\}\x60}>/,
	);
});
