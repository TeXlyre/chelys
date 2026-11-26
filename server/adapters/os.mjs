// server/adapters/os.mjs
export const platform = () =>
	process.platform === 'darwin'
		? 'macos'
		: process.platform === 'win32'
			? 'windows'
			: 'linux';
export const arch = () =>
	process.arch === 'x64'
		? 'x86_64'
		: process.arch === 'arm64'
			? 'aarch64'
			: process.arch;
