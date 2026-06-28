// scripts/update-version.mjs
import fs from "node:fs";

const pkgPath = "package.json";
const cargoTomlPath = "src-tauri/Cargo.toml";
const tauriConfPath = "src-tauri/tauri.conf.json";

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;

if (!version) {
    console.error("package.json does not contain a version field.");
    process.exit(1);
}

const semverLike =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semverLike.test(version)) {
    console.error(`Invalid package.json version: ${version}`);
    process.exit(1);
}

// Update tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// Update Cargo.toml package version only
let cargoToml = fs.readFileSync(cargoTomlPath, "utf8");

cargoToml = cargoToml.replace(
    /(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
    `$1"${version}"`
);

fs.writeFileSync(cargoTomlPath, cargoToml);

console.log(`Synced app version: ${version}`);