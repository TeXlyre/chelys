// scripts/build-server.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const aliases = [
	['@tauri-apps/api/core', 'server/adapters/core.mjs'],
	['@tauri-apps/api/event', 'server/adapters/events.mjs'],
	['@tauri-apps/api/path', 'server/adapters/path.mjs'],
	['@tauri-apps/plugin-os', 'server/adapters/os.mjs'],
	['@tauri-apps/plugin-fs', 'server/adapters/fs.mjs'],
	['y-indexeddb', 'server/adapters/y-indexeddb.mjs'],
	['@/i18n', 'src/i18n-shim.ts'],
	['@/logging', 'external/texlyre/src/logging.ts'],
	['@texlyre', 'external/texlyre/src'],
	['@chelys', 'external/texlyre/src/chelys'],
	['@src', 'src'],
	['@', 'src'],
].map(([find, replacement]) => ({
	find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)`),
	replacement: path.resolve(root, replacement),
}));
await build({
	configFile: false,
	root,
	publicDir: false,
	resolve: { alias: aliases },
	define: {
		__APP_VERSION__: JSON.stringify(
			JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
				.version,
		),
	},
	build: {
		ssr: 'src/runtime/serverEntry.ts',
		outDir: 'server/dist',
		emptyOutDir: true,
		target: 'node22',
		minify: false,
		rollupOptions: { output: { entryFileNames: 'runtime.mjs', format: 'es' } },
	},
});
