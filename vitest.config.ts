import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			'@tauri-apps/api/core': resolve('./tests/mocks/tauri-core.ts'),
			'@tauri-apps/api/event': resolve('./tests/mocks/tauri-event.ts'),
			'@src': resolve('./src'),
			'@tests': resolve('./tests'),
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
	},
});
