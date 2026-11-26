// tests/server/monitor.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(
	new URL('../../src/plugins/infrastructure/systemMonitor.ts', import.meta.url),
);

function collectorSource() {
	const text = fs.readFileSync(source, 'utf8');
	const found = text.match(
		/const COLLECTOR = String\.raw`([\s\S]+?)`;\s*export const systemMonitorRecipe/,
	);
	assert.ok(
		found,
		'collector must be packaged as a self-contained recipe command',
	);
	return found[1];
}

test('unprivileged collector reports a bounded system snapshot using Node core APIs', async () => {
	const collector = spawn(process.execPath, ['-e', collectorSource()], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let buffer = '';
	let stderr = '';
	collector.stdout.setEncoding('utf8');
	collector.stdout.on('data', (text) => {
		buffer += text;
	});
	collector.stderr.on('data', (text) => {
		stderr += text;
	});
	try {
		const sample = await new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('No monitoring sample')),
				4000,
			);
			collector.stdout.on('data', () => {
				const line = buffer
					.split('\n')
					.find((item) => item.startsWith('CHELYS_METRICS_V1 '));
				if (!line) return;
				clearTimeout(timer);
				try {
					resolve(JSON.parse(line.slice('CHELYS_METRICS_V1 '.length)));
				} catch (error) {
					reject(error);
				}
			});
			collector.once('error', (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
		assert.equal(sample.v, 1);
		assert.equal(sample.scope, 'system');
		assert.ok(Date.now() - Date.parse(sample.sampledAt) < 5000);
		assert.ok(sample.metrics.cpu.cores > 0);
		assert.ok(sample.metrics.memory.totalBytes > 0);
		assert.ok(Object.hasOwn(sample.metrics, 'gpu'));
		assert.ok(Object.hasOwn(sample.metrics, 'energy'));
		assert.ok(buffer.length < 20_000, 'a single snapshot must remain bounded');
		assert.equal(stderr, '');
	} finally {
		collector.kill('SIGTERM');
	}
});

test('collector accepts an isolated container scope without requiring host privileges', async () => {
	const collector = spawn(process.execPath, ['-e', collectorSource()], {
		env: { ...process.env, CHELYS_MONITOR_SCOPE: 'container' },
	});
	let output = '';
	try {
		const sample = await new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('No container-scoped sample')),
				4000,
			);
			collector.stdout.setEncoding('utf8');
			collector.stdout.on('data', (chunk) => {
				output += chunk;
				const line = output
					.split('\n')
					.find((item) => item.startsWith('CHELYS_METRICS_V1 '));
				if (line) {
					clearTimeout(timer);
					resolve(JSON.parse(line.slice('CHELYS_METRICS_V1 '.length)));
				}
			});
			collector.once('error', reject);
		});
		assert.equal(sample.scope, 'container');
		assert.ok(
			['cgroup', 'os-host-view'].includes(sample.metrics.memory.source),
		);
	} finally {
		collector.kill('SIGTERM');
	}
});
