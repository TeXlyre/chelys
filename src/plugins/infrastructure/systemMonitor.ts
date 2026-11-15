// src/plugins/infrastructure/systemMonitor.ts
import type { Recipe, RecipeStatus } from '../../plugin-host/types';

export const METRICS_PREFIX = 'CHELYS_METRICS_V1 ';
export const MONITOR_FIELDS = [
	{ id: 'cpu', label: 'CPU', sensitivity: 'low' },
	{ id: 'memory', label: 'Memory', sensitivity: 'low' },
	{ id: 'storage', label: 'Storage', sensitivity: 'medium' },
	{ id: 'network', label: 'Network throughput', sensitivity: 'medium' },
	{ id: 'gpu', label: 'GPU', sensitivity: 'medium' },
	{ id: 'temperatures', label: 'Temperatures', sensitivity: 'medium' },
	{ id: 'energy', label: 'Energy sensors', sensitivity: 'high' },
	{ id: 'process', label: 'Collector process', sensitivity: 'high' },
] as const;

const COLLECTOR = String.raw`
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const PREFIX = 'CHELYS_METRICS_V1 ';
const scope = process.env.CHELYS_MONITOR_SCOPE === 'container' ? 'container' : 'system';
const max = (n) => Number.isFinite(n) ? n : null;
const file = (p) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; } };
const dir = (p) => { try { return fs.readdirSync(p).slice(0, 24); } catch { return []; } };
const prev = { cpu: null, cgroup: null, net: null };
function cpu() {
  const cores = os.cpus();
  const totals = cores.reduce((r, c) => {
    for (const [k, v] of Object.entries(c.times)) r[k] = (r[k] || 0) + v;
    return r;
  }, {});
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  const idle = totals.idle || 0;
  const usage = prev.cpu && all > prev.cpu.all ?
    Math.max(0, Math.min(100, 100 * (1 - (idle - prev.cpu.idle) / (all - prev.cpu.all)))) : null;
  prev.cpu = { all, idle };
  if (scope === 'container') {
    const stat = file('/sys/fs/cgroup/cpu.stat');
    const match = stat && stat.match(/^usage_usec\s+(\d+)$/m);
    const maxCpu = file('/sys/fs/cgroup/cpu.max')?.split(/\s+/) || [];
    const quota = /^\d+$/.test(maxCpu[0] || '') ? Number(maxCpu[0]) : null;
    const period = /^\d+$/.test(maxCpu[1] || '') ? Number(maxCpu[1]) : null;
    const capacity = quota !== null && period > 0 ? quota / period : cores.length;
    const microseconds = match ? Number(match[1]) : null;
    const now = Date.now();
    if (microseconds !== null && capacity > 0) {
      const cgroupUsage = prev.cgroup && now > prev.cgroup.now ?
        100 * (microseconds - prev.cgroup.microseconds) / ((now - prev.cgroup.now) * 1000 * capacity) : null;
      prev.cgroup = { microseconds, now };
      return { utilizationPercent: cgroupUsage === null ? null : Math.max(0, Math.min(100, cgroupUsage)), cores: cores.length, cpuCapacity: capacity, source: 'cgroup' };
    }
  }
  return { utilizationPercent: max(usage), cores: cores.length, loadAverage: os.loadavg().map(max), source: scope === 'container' ? 'os-host-view' : 'os' };
}
function memory() {
  const total = os.totalmem(); const free = os.freemem();
  const limit = file('/sys/fs/cgroup/memory.max');
  const used = file('/sys/fs/cgroup/memory.current');
  const cgroupLimit = limit && /^\d+$/.test(limit) ? Number(limit) : null;
  const cgroupUsed = used && /^\d+$/.test(used) ? Number(used) : null;
  if (scope === 'container' && cgroupLimit !== null && cgroupUsed !== null) {
    return { totalBytes: cgroupLimit, usedBytes: cgroupUsed, availableBytes: Math.max(0, cgroupLimit - cgroupUsed), source: 'cgroup' };
  }
  return { totalBytes: total, usedBytes: total - free, availableBytes: free, source: scope === 'container' ? 'os-host-view' : 'os' };
}
function storage() {
  try {
    const path = process.env.CHELYS_MONITOR_PATH || process.cwd();
    const s = fs.statfsSync(path, { bigint: true });
    return { totalBytes: String(s.blocks * s.bsize), availableBytes: String(s.bavail * s.bsize), scope: 'collector-filesystem' };
  } catch { return null; }
}
function network() {
  const text = file('/proc/net/dev');
  if (!text) return null;
  let rx = 0, tx = 0;
  for (const line of text.split('\n').slice(2)) {
    const m = line.trim().match(/^([^:]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
    if (m && m[1].trim() !== 'lo') { rx += Number(m[2]); tx += Number(m[3]); }
  }
  const now = Date.now();
  const rate = prev.net && now > prev.net.now ? {
    receiveBytesPerSecond: Math.max(0, Math.round(1000 * (rx - prev.net.rx) / (now - prev.net.now))),
    transmitBytesPerSecond: Math.max(0, Math.round(1000 * (tx - prev.net.tx) / (now - prev.net.now)))
  } : { receiveBytesPerSecond: null, transmitBytesPerSecond: null };
  prev.net = { now, rx, tx };
  return { ...rate, source: 'proc-net-dev' };
}
function gpu() {
  try {
    const raw = execFileSync('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw',
      '--format=csv,noheader,nounits'
    ], { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8192 });
    return raw.trim().split('\n').slice(0, 4).map((line) => {
      const [model, utilization, used, total, temp, watts] = line.split(',').map((s) => s.trim());
      const number = (value) => value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
      return { model, utilizationPercent: number(utilization), usedMemoryMiB: number(used), totalMemoryMiB: number(total), temperatureC: number(temp), powerWatts: number(watts) };
    });
  } catch { return null; }
}
function temperatures() {
  const readings = [];
  for (const zone of dir('/sys/class/thermal')) {
    if (!/^thermal_zone\d+$/.test(zone)) continue;
    const raw = file('/sys/class/thermal/' + zone + '/temp');
    const value = raw === null ? NaN : Number(raw);
    if (Number.isFinite(value) && value > -100000 && value < 300000) readings.push({ label: zone, celsius: value / 1000 });
    if (readings.length >= 16) break;
  }
  for (const hwmon of dir('/sys/class/hwmon')) {
    if (!/^hwmon\d+$/.test(hwmon)) continue;
    for (const name of dir('/sys/class/hwmon/' + hwmon)) {
      if (!/^temp\d+_input$/.test(name)) continue;
      const raw = file('/sys/class/hwmon/' + hwmon + '/' + name);
      const value = raw === null ? NaN : Number(raw);
      if (Number.isFinite(value) && value > -100000 && value < 300000) readings.push({ label: hwmon + '/' + name, celsius: value / 1000 });
      if (readings.length >= 16) break;
    }
    if (readings.length >= 16) break;
  }
  return readings.length ? readings : null;
}
function energy() {
  for (const entry of dir('/sys/class/powercap')) {
    if (!/^intel-rapl:\d+$/.test(entry)) continue;
    const microjoules = file('/sys/class/powercap/' + entry + '/energy_uj');
    if (microjoules && /^\d+$/.test(microjoules)) return { counterJoules: Number(microjoules) / 1e6, source: 'powercap', note: 'Hardware counter; resets/wraps' };
  }
  return null;
}
function sample() {
  const used = process.memoryUsage();
  const metrics = {
    cpu: cpu(), memory: memory(), storage: storage(), network: network(),
    gpu: gpu(), temperatures: temperatures(), energy: energy(),
    process: { pid: process.pid, rssBytes: used.rss, heapBytes: used.heapUsed }
  };
  const message = PREFIX + JSON.stringify({ v: 1, sampledAt: new Date().toISOString(), scope, metrics });
  if (message.length <= 16384) process.stdout.write(message + '\n');
}

cpu(); network();
const first = setTimeout(sample, 300);
const timer = setInterval(sample, 5000);
process.on('SIGTERM', () => { clearTimeout(first); clearInterval(timer); process.exit(0); });
`;

export const systemMonitorRecipe: Recipe = {
	id: 'system-monitor',
	type: 'infrastructure',
	name: 'System Monitor',
	version: '1.0.0',
	notes:
		'On-demand host or container-scoped read-only telemetry. System mode requires Node.js 22 or later. Container mode uses an unprivileged official Node image and sees container namespaces. Readings depend on hardware, drivers and OS permissions. Remote metrics are private until explicitly shared.',
	env: {},
	modes: [
		{
			kind: 'system',
			installSteps: [],
			runCommand: { command: 'node', args: ['-e', COLLECTOR] },
		},
		{
			kind: 'docker',
			image: 'docker.io/library/node:22-alpine',
			buildSteps: [],
			runArgs: [
				'--network',
				'none',
				'--read-only',
				'--cap-drop=ALL',
				'--security-opt=no-new-privileges',
				'--pids-limit',
				'64',
				'--memory',
				'128m',
				'--env',
				'CHELYS_MONITOR_SCOPE=container',
			],
			command: ['node', '-e', COLLECTOR],
		},
	],
	typeConfig: { inspection: 'system-monitor' },
};

export interface MonitorSnapshot {
	v: number;
	sampledAt: string;
	scope: string;
	metrics: Record<string, unknown>;
}

export function supportsSystemMonitor(recipe: Recipe): boolean {
	return (
		recipe.type === 'infrastructure' &&
		recipe.typeConfig.inspection === 'system-monitor'
	);
}

export function latestMonitorSnapshot(
	status: RecipeStatus,
): MonitorSnapshot | null {
	if (status.state !== 'running') return null;
	for (const line of [...status.logTail].reverse()) {
		if (!line.startsWith(METRICS_PREFIX)) continue;
		try {
			const data = JSON.parse(
				line.slice(METRICS_PREFIX.length),
			) as MonitorSnapshot;
			if (
				data.v !== 1 ||
				!Number.isFinite(Date.parse(data.sampledAt)) ||
				Date.now() - Date.parse(data.sampledAt) > 20_000 ||
				Date.parse(data.sampledAt) - Date.now() > 10_000 ||
				!data.metrics ||
				typeof data.metrics !== 'object' ||
				Array.isArray(data.metrics)
			)
				continue;
			return data;
		} catch {}
	}
	return null;
}
