# Chelys

A local desktop companion app for **[TeXlyre](https://github.com/TeXlyre/texlyre)**. Chelys runs the local tooling that a browser cannot, such as language servers and typesetting engines, and keeps your TeXlyre account synchronized across your devices over peer-to-peer connections. Built with Tauri, Rust, React, TypeScript, and Yjs.

[![Latest release](https://img.shields.io/github/v/release/TeXlyre/chelys?include_prereleases&label=download)](https://github.com/TeXlyre/chelys/releases/latest)
[![Recipe registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Ftexlyre.github.io%2Fchelys-recipes%2Fapi%2Frecipes.json&query=%24.version&label=recipes&color=blue)](https://github.com/TeXlyre/chelys-recipes)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg?logo=tauri)](https://v2.tauri.app/)
[![Rust 1.88+](https://img.shields.io/badge/Rust-1.88%2B-000000.svg?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%23007acc.svg)](https://www.typescriptlang.org/)

![TeXlyre and Chelys WebRTC architecture](showcase/texlyre_chelys_webrtc_architecture.svg)

> **Status:** This is the fourth phase (Tasks [2](https://texlyre.github.io/blog/chelys-lsp-bridge), [3](https://texlyre.github.io/blog/chelys-peer-to-peer-tools), [5](https://texlyre.github.io/blog/chelys-local-typesetters) & 6) of development, currently covering language servers and typesetting engines, and file storage, with WebSocket and WebRTC bridge for local tool sharing. Distributed storage are planned as per the [project scope](https://texlyre.github.io/blog/nlnet-ngi0-funding-overview).

## Features

### Local Tooling

Chelys installs and runs **recipes**, which are background tools such as language servers and typesetting engines. A recipe runs either as a native **system** process or inside a **Docker** container. Chelys manages its lifecycle and exposes it to TeXlyre over a local WebSocket or WebRTC endpoint.

Ready-made recipes are available at [chelys-recipes](https://texlyre.github.io/chelys-recipes). Chelys automates this setup, but it is optional. If you prefer, you can run a language server yourself and point TeXlyre at its WebSocket address directly, following [Using an LSP with TeXlyre](https://texlyre.github.io/docs/lsp-with-texlyre).

### Account Synchronization

Your TeXlyre settings, properties, secrets, and records synchronize directly between your devices using **[Yjs](https://github.com/yjs/yjs) CRDTs** over **WebRTC** without a central server storing data. A presence indicator shows which of your devices are currently connected in Chelys.

### Secure Pairing

Chelys pairs with your existing TeXlyre identity using your username, password, and a **WebAuthn/PRF** passkey or a generated temporary pseudo-PRF key to derive an encrypted account room. Credentials use the operating system's native keychain when available, with a warned local fallback if it is inaccessible.

## Quick Start

Download the latest build for your platform from the [Releases](https://github.com/TeXlyre/chelys/releases) page:

* **macOS**: `.dmg` (Apple Silicon and Intel). Note that several typesetter recipes do not support `arm64` architectures.
* **Windows**: `.msi` or `.exe` (release workflow creates `msixbundle` as an artifact available on [Windows Store](https://apps.microsoft.com/detail/9p96z1wpb4wk?hl=en-GB&gl=DE))
* **Linux**: `.AppImage` or `.deb`

Open Chelys and sign in with your TeXlyre account.

Some recipes require additional tools to be installed on your system:

* **Docker recipes** require [Docker](https://docs.docker.com/get-docker/).
* **System recipes** may require [Rust/Cargo](https://www.rust-lang.org/tools/install) if they install Rust-based tools.
* On **Windows**, Cargo-based recipes may also require Microsoft C++ Build Tools.

For durther setup commands, see [INSTALL.md](INSTALL.md).

## Build from Source

Requires [Node.js](https://nodejs.org/) LTS, the [Rust toolchain](https://www.rust-lang.org/tools/install), and [Tauri's system prerequisites](https://v2.tauri.app/start/prerequisites/). All typesetter recipes require [Docker](https://docs.docker.com/get-docker/).

```bash
git clone --recursive https://github.com/TeXlyre/chelys.git
cd chelys
npm install
npm run tauri build    # produce a release build
npm run tauri dev      # run in development
```

The output executable is found in `./src-tauri/target/release/Chelys*`

## License

Chelys is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
See [LICENSE](https://github.com/TeXlyre/chelys/blob/main/LICENSE) for the complete license text.

## Funding

[Chelys is funded by NLnet](https://nlnet.nl/project/Texlyre/) through the NGI0 Commons Fund, which is supported by the European Commission's Next Generation Internet programme.

## Headless servers and remote control

Chelys also supports an optional Node-based server runtime and a shared CLI/GUI remote-control API. See [HEADLESS.md](HEADLESS.md) for deployment, account and recipe commands, access policies, and WebRTC/WebSocket peer management.

### Appearance

Chelys uses TeXlyre's Wide theme, shared controls, and colour palettes directly from the `external/texlyre` submodule. Run `npm run init:submodules` to populate the theme assets (existing sparse Git checkouts are extended in place). Chelys-specific styles live under `src/styles/components`.

Choose a palette under **Settings → Appearance → Colour theme**; the header and login toggle use the `themeToggle.light` and `themeToggle.dark` targets in `chelys.config.ts`. The preference is stored in Chelys settings, independently of TeXlyre settings. System follows the OS colour mode.

### Endpoints and services

An `endpoint` recipe runs an independent application backend using its existing system, Docker or connect mode. It declares `typeConfig.protocol`, `transportType` (`webrtc` or `websocket`), and `transportUrl`. Each running endpoint advertises `generic-plugin-config:<machine UUID>.<recipe ID>` with its protocol and transport. WebRTC uses the existing `endpoint:<machine UUID>.<recipe ID>` label and account room; the private upstream URL is not advertised. Use a reachable secured URL for direct WebSocket clients.

A `service` recipe is a process-free collection of references, e.g.:

```json
{"id":"analysis","name":"Analysis","type":"service","env":{},"modes":[{"kind":"connect"}],"typeConfig":{"members":["ffmpeg","siglip","12345678-1234-1234-1234-123456789abc/gaze-execution"]}}
```

Open Services in the dashboard, create/import a group, and select local or remote plugins. Install prepares missing local members from the configured registries; existing installations are reused. Run starts missing local members and checks remote members already running on same-account peers with control-read permission. Check members refreshes remote status explicitly. A running group advertises `service-group-config:<machine UUID>.<recipe ID>` with member instance IDs. Remote status is last checked, not a live health probe. Stop, uninstall or remove a group does not stop or uninstall its member plugins; manage those independently in Plugins. No nested groups, remote provisioning, or extra group container. Group lifecycle commands are available through the same CLI and authorized remote control API as other recipes. Installation and start enforce permissions for any local member mutation (including registration and infrastructure management). A group cannot grant additional privileges. Explicitly shared System Monitor telemetry remains independently permissioned. For Laboritorium, add the new `https://texlyre.github.io/laboritorium-recipes/api/recipes.json` registry once published, or import recipes locally.
