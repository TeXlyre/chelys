// src/plugin-host/containerState.ts
export type ExistingContainerState = 'absent' | 'running' | 'stopped';

export function containerStateFromInspect(
	code: number,
	lines: readonly string[],
	name: string,
): ExistingContainerState {
	if (code !== 0) {
		const detail = lines.join('\n').trim();
		if (
			/no such (?:container|object)|container .* (?:does not exist|not found)|unable to find (?:container|object)/i.test(
				detail,
			)
		) {
			return 'absent';
		}
		throw new Error(
			`Cannot inspect container "${name}": ${detail || `engine exited with code ${code}`}`,
		);
	}

	const status = lines
		.map((line) => line.trim().toLowerCase())
		.find((line) =>
			[
				'running',
				'created',
				'configured',
				'initialized',
				'exited',
				'stopped',
				'dead',
				'paused',
				'restarting',
				'removing',
			].includes(line),
		);
	if (status === 'running') return 'running';
	if (
		status &&
		[
			'created',
			'configured',
			'initialized',
			'exited',
			'stopped',
			'dead',
		].includes(status)
	)
		return 'stopped';
	throw new Error(
		`Container "${name}" is ${status ?? 'in an unknown state'}; check it in Docker/Podman before starting the recipe`,
	);
}
