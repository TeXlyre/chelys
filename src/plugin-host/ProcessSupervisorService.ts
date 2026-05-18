// src/plugin-host/ProcessSupervisorService.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { CommandSpec } from './types';

interface ProcessOutputEvent {
	handleId: string;
	stream: 'stdout' | 'stderr';
	line: string;
}

interface ProcessStatusEvent {
	handleId: string;
	status: 'running' | 'stopped' | 'exited' | 'failed';
	exitCode: number | null;
}

type OutputListener = (event: ProcessOutputEvent) => void;
type StatusListener = (event: ProcessStatusEvent) => void;

class ProcessSupervisorService {
	private outputListeners = new Set<OutputListener>();
	private statusListeners = new Set<StatusListener>();
	private initialized = false;

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		await listen<ProcessOutputEvent>('process-output', (event) => {
			this.outputListeners.forEach((listener) => listener(event.payload));
		});
		await listen<ProcessStatusEvent>('process-status', (event) => {
			this.statusListeners.forEach((listener) => listener(event.payload));
		});
	}

	onOutput(listener: OutputListener): () => void {
		this.outputListeners.add(listener);
		return () => this.outputListeners.delete(listener);
	}

	onStatus(listener: StatusListener): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	async runCommand(handleId: string, spec: CommandSpec): Promise<number> {
		return invoke<number>('process_run_command', { handleId, spec });
	}

	async spawn(handleId: string, spec: CommandSpec): Promise<void> {
		await invoke('process_spawn', { handleId, spec });
	}

	async stop(handleId: string): Promise<void> {
		await invoke('process_stop', { handleId });
	}

	async isRunning(handleId: string): Promise<boolean> {
		return invoke<boolean>('process_is_running', { handleId });
	}

	async listRunning(): Promise<string[]> {
		return invoke<string[]>('process_list_running');
	}
}

export const processSupervisorService = new ProcessSupervisorService();
