#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const SPARSE_PATHS = [
    "src/services",
    "src/utils",
    "src/types",
    "src/extensions/yjs",
    "src/styles/shared",
    "chelys",
];

const SUBMODULE_DIR = "external/texlyre";

if (!existsSync(".git")) {
    console.log("No git metadata; assuming submodule is already vendored.");
    process.exit(0);
}

const git = (...args) => execFileSync("git", args, { stdio: "inherit" });

git("submodule", "update", "--init", "--recursive");
git("-C", SUBMODULE_DIR, "sparse-checkout", "init", "--cone");
git("-C", SUBMODULE_DIR, "sparse-checkout", "set", ...SPARSE_PATHS);