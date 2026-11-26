// tests/server/i18n.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const locale = (name) => JSON.parse(read(`translations/locales/${name}.json`));
const variables = (text) =>
	[
		...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1])),
	].sort();

test('Chelys locale extensions share the same English source and interpolation variables', () => {
	const en = locale('en');
	assert.deepEqual(locale('base-en'), en);
	for (const name of ['ar', 'de', 'es', 'it', 'zh-CN']) {
		for (const [key, value] of Object.entries(locale(name))) {
			assert.ok(Object.hasOwn(en, key), `${name}: ${key}`);
			assert.deepEqual(variables(value), variables(en[key]), `${name}: ${key}`);
		}
	}
});

test('Arabic covers every Chelys-specific English key', () => {
	assert.deepEqual(
		Object.keys(locale('ar')).sort(),
		Object.keys(locale('en')).sort(),
	);
});

test('Chelys extends upstream translations without duplicating English keys', {
	skip: !existsSync(
		new URL('external/texlyre/translations/locales/en.json', root),
	),
}, () => {
	const upstream = JSON.parse(
		read('external/texlyre/translations/locales/en.json'),
	);
	for (const key of Object.keys(locale('en')))
		assert.ok(!Object.hasOwn(upstream, key), key);
});

test('Desktop uses upstream i18next while the server retains the English shim', () => {
	assert.match(read('src/i18n.ts'), /from '@texlyre\/i18n'/);
	assert.match(
		read('src/i18n.ts'),
		/addResourceBundle\(language, 'translation', bundle, true, false\)/,
	);
	assert.match(read('scripts/build-server.mjs'), /i18n-shim/);
	assert.match(read('scripts/init-submodules.mjs'), /'translations'/);
});
