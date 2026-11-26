// scripts/update-version.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';

const pkgPath = 'package.json';
const cargoTomlPath = 'src-tauri/Cargo.toml';
const credentialsCargoTomlPath = 'native/credentials/Cargo.toml';
const launcherCargoTomlPath = 'native/launcher/Cargo.toml';
const cargoLockPath = 'src-tauri/Cargo.lock';
const packageLockPath = 'package-lock.json';
const tauriConfPath = 'src-tauri/tauri.conf.json';
const flatpakManifestPath = 'packaging/flatpak/io.github.texlyre.chelys.yml';
const flatpakMetainfoPath =
	'packaging/flatpak/io.github.texlyre.chelys.metainfo.xml';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

if (!version) {
	console.error('package.json does not contain a version field.');
	process.exit(1);
}

const semverLike = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semverLike.test(version)) {
	console.error(`Invalid package.json version: ${version}`);
	process.exit(1);
}

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

for (const manifestPath of [
	cargoTomlPath,
	credentialsCargoTomlPath,
	launcherCargoTomlPath,
]) {
	const content = fs.readFileSync(manifestPath, 'utf8');
	const updated = content.replace(
		/(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
		`$1"${version}"`,
	);
	if (!updated.includes(`version = "${version}"`)) {
		throw new Error(`Unable to synchronize ${manifestPath}`);
	}
	if (updated !== content) fs.writeFileSync(manifestPath, updated);
}

const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
const updatedCargoLock = cargoLock.replace(
	/(\[\[package\]\]\s*\nname = "chelys-app"\s*\nversion = ")[^"]+"/,
	`$1${version}"`,
);
if (!updatedCargoLock.includes(`name = "chelys-app"\nversion = "${version}"`)) {
	throw new Error(`Unable to synchronize ${cargoLockPath}`);
}
if (updatedCargoLock !== cargoLock)
	fs.writeFileSync(cargoLockPath, updatedCargoLock);

const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
if (
	packageLock.name !== pkg.name ||
	packageLock.packages?.['']?.name !== pkg.name
) {
	throw new Error(`Unexpected root package in ${packageLockPath}`);
}
if (
	packageLock.version !== version ||
	packageLock.packages[''].version !== version
) {
	packageLock.version = version;
	packageLock.packages[''].version = version;
	fs.writeFileSync(
		packageLockPath,
		`${JSON.stringify(packageLock, null, '\t')}\n`,
	);
}

let flatpakManifest = fs.readFileSync(flatpakManifestPath, 'utf8');
flatpakManifest = flatpakManifest.replace(
	/url:\s*https:\/\/github\.com\/TeXlyre\/chelys\/releases\/download\/v[^/\s]+\/[Cc]helys_[^\s]+_amd64\.deb/,
	`url: https://github.com/TeXlyre/chelys/releases/download/v${version}/Chelys_${version}_amd64.deb`,
);

let flatpakMetainfo = fs.readFileSync(flatpakMetainfoPath, 'utf8');
flatpakMetainfo = flatpakMetainfo.replace(
	/(<release\s+version=")[^"]+("\s+date=")/,
	`$1${version}$2`,
);

const debPath =
	process.argv[2] ??
	`src-tauri/target/release/bundle/deb/Chelys_${version}_amd64.deb`;

if (fs.existsSync(debPath)) {
	const sha256 = crypto
		.createHash('sha256')
		.update(fs.readFileSync(debPath))
		.digest('hex');
	flatpakManifest = flatpakManifest.replace(
		/(^\s*sha256:\s*)\S+/m,
		`$1${sha256}`,
	);
	console.log(`Synced Flatpak Debian SHA-256: ${sha256}`);
}

fs.writeFileSync(flatpakManifestPath, flatpakManifest);
fs.writeFileSync(flatpakMetainfoPath, flatpakMetainfo);

console.log(`Synced app version: ${version}`);
