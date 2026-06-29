# Chelys

A **[local-first](https://www.inkandswitch.com/essay/local-first/)** desktop companion for **[TeXlyre](https://github.com/TeXlyre/texlyre)**. Chelys runs the local tooling that a browser cannot, such as language servers and typesetting engines, and keeps your TeXlyre account synchronized across your devices over peer-to-peer connections. Built with Tauri, React, TypeScript, and Yjs.

[![Latest release](https://img.shields.io/github/v/release/TeXlyre/chelys?include_prereleases&label=download)](https://github.com/TeXlyre/chelys/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0) [![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg?logo=tauri)](https://v2.tauri.app/) [![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%23007acc.svg)](https://www.typescriptlang.org/)

> **Status:** This is the [first phase (Task 2)](https://texlyre.github.io/blog/nlnet-ngi0-funding-overview#task-2-chelys-proof-of-concept-local-lsp-bridge) of development, currently covering language server setup only. Local typesetting engines and distributed storage are planned, per the [project scope](https://texlyre.github.io/blog/nlnet-ngi0-funding-overview).

## Features

### Local Tooling

Chelys installs and runs **recipes**, which are background tools such as language servers and typesetting engines. A recipe runs either as a native **system** process or inside a **Docker** container. Chelys manages its lifecycle and exposes it to TeXlyre over a local WebSocket endpoint. Ready-made recipes are available at [chelys-recipes](https://texlyre.github.io/chelys-recipes). Chelys automates this setup, but it is optional. If you prefer, you can run a language server yourself and point TeXlyre at its WebSocket address directly, following [Using an LSP with TeXlyre](https://texlyre.github.io/docs/lsp-with-texlyre).

### Account Synchronization

Your TeXlyre settings, properties, secrets, and records synchronize directly between your devices using **[Yjs](https://github.com/yjs/yjs) CRDTs** over **WebRTC** without a central server storing data. A presence indicator shows which of your devices are currently connected.

### Secure Pairing

Chelys pairs with your existing TeXlyre identity using your username, password, and a **WebAuthn/PRF** passkey to derive an encrypted account room. Credentials are stored in your operating system's native keychain.

## Quick Start

Download the latest build for your platform from the [Releases](https://github.com/TeXlyre/chelys/releases) page:

- **macOS**: `.dmg` (Apple Silicon and Intel)
- **Windows**: `.msi`
- **Linux**: `.AppImage` or `.deb`

Open Chelys and sign in with your TeXlyre account. Running recipes in Docker mode requires [Docker](https://docs.docker.com/get-docker/) installed and available on your system.

## Build from Source

Requires [Node.js](https://nodejs.org/) (LTS) and the [Rust toolchain](https://www.rust-lang.org/tools/install) with [Tauri's system prerequisites](https://v2.tauri.app/start/prerequisites/).

    git clone --recursive https://github.com/TeXlyre/chelys.git
    cd chelys
    npm install
    npm run tauri build    # produce a release build
    npm run tauri dev      # run in development

## License

Chelys is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
See [LICENSE](https://github.com/TeXlyre/chelys/blob/main/LICENSE) for the complete license text.

## Funding

[Chelys is funded by NLnet](https://nlnet.nl/project/Texlyre/) through the NGI0 Commons Fund, which is supported by the European Commission's Next Generation Internet programme.
