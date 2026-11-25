# Chelys headless API

## Distribution and runtime

Chelys Desktop bundles the desktop UI, CLI launcher, headless Node runtime, native WebRTC addon, and credential helper. Chelys Server contains the same CLI/headless components without Tauri. Installed distributions do not require Node.js, npm, or Rust on the target machine.

| Distribution | Build | Result |
| --- | --- | --- |
| Desktop | `npm run tauri -- build` | Tauri installers with the bundled runtime and `chelys-runtime` launcher |
| Server | `npm run package:server` | `release/chelys-server-{target}/` (portable `chelys` executable and runtime) |

Source builds require Node.js 22+, Rust/Cargo and the platform-specific Tauri prerequisites for desktop. The distribution packager installs and validates native server dependencies automatically when needed:

```sh
npm ci
npm run package:server
npm run tauri -- build
```

For development use of `chelys serve` directly from a source checkout without packaging, run `npm install --prefix server --omit=dev` once. `npm run tauri -- build` runs the desktop and server build steps. The release workflow produces both installers and standalone server archives per native OS/architecture. Server distributions start with `chelys serve`; their control API does not require an open desktop window.

### CLI installation

| Installer | Command location |
| --- | --- |
| Windows MSIX / Microsoft Store | `chelys.exe` application-execution alias |
| Windows desktop installer | Bundled `chelys-runtime.exe`; configure a terminal alias if required |
| macOS desktop | Account → Background server → Install terminal command (`~/.local/bin/chelys`) |
| Linux DEB/RPM desktop | Bundled `chelys-runtime`; terminal command can be installed from Account → Background server |
| Flatpak | `flatpak run --command=chelys-runtime io.github.texlyre.chelys ...` |
| Server archive | `./chelys serve` or install the included launcher to a directory in `PATH` |

### Unified desktop, CLI and remote control

**One service implementation:** the Node runtime owns recipe execution, native WebRTC, account collaboration, access policies, credentials, Traefik routes, persistence and remote control. The complete existing React desktop dashboard is a client of the **same** local JSON-RPC API as `chelys` CLI. The desktop does not launch an additional recipe manager, WebRTC controller, or remote-control host. The former reduced attached dashboard and the unused Tauri-native recipe/WebRTC controller and renderer WebRTC polyfill have been removed. Tauri still provides OS/window/dialog/file integrations where a desktop-only native capability is required.

| Interface | Connection | Capabilities |
| --- | --- | --- |
| Desktop | `instance_rpc` proxy to the shared socket/pipe | Full recipe browser/forms, import/edit/install/run/logs, container settings, account/profile, access policy, peers, settings, collaborator presence and UI-only file/export tools |
| CLI | Same socket/pipe, using `server/cli.mjs` | Scripting and local automation; no desktop required |
| Remote peer | Same command dispatcher with explicit access-policy checks | Only permitted remote operations; privileged full-recipe and credential commands are **local-only** |

The desktop starts the bundled server only if no existing instance owns the socket. It waits for a valid RPC response before rendering the full UI; it shows a recoverable error screen if startup or shared storage fails. Once started, the daemon remains available to the CLI/remote peers **even when the desktop UI closes**. The UI polls server-side recipe status, account presence and service-room awareness; it does not create duplicate WebRTC connections for avatars. Settings and browser-backed UI data use the authoritative server store, with initial migration and subsequent synchronization when another client changes them.

### Instance startup preference

Account Settings → **Profile runtime owner** configures the **startup policy** of that one backend. There are not separate desktop and headless recipe engines anymore; the desktop remains the full native UI in all modes.

| Preference | Startup behavior |
| --- | --- |
| **Automatic** (default) | Reuse whichever backend already serves the profile; opening the desktop starts the bundled backend if none is running. |
| **Desktop-managed** | Only the desktop launcher may start the daemon when none is running; a standalone new `chelys serve` is rejected. The daemon continues after the desktop closes. |
| **Headless** | The daemon may be started independently using `chelys serve`, or started automatically when the desktop opens. The full UI connects to it in either case. |

`instance-owner.json` is stored in the shared data directory. Setting a different preference does not forcibly stop an active daemon; restart Chelys and, when necessary, stop the prior daemon/service to change launch policy. CLI recovery commands work even if no daemon is available:

```sh
chelys runtime show
chelys runtime preference
chelys runtime preference automatic
chelys runtime preference desktop
chelys runtime preference headless
```

Only one daemon may bind a profile socket/pipe, with a short-lived startup lock to serialize competing starts. Desktop and standalone server use one data directory and credential store, with the same environment overrides. The desktop autostart toggle launches `chelys --headless` at OS login, not a desktop window. It is opt-in and disabled for Desktop-managed mode. Default instance directory: `XDG_DATA_HOME/chelys` or `~/.local/share/chelys`; `CHELYS_DATA_DIR` must be absolute. Use a separate data directory for genuinely independent instances.

For existing desktop installations, launch the upgraded desktop once to copy the old `chelys-recipes.json` if the new shared manifest is absent and to import previously saved browser settings into a new shared store. Do this before converting to background-only startup. The app never deletes the old recipe manifest during migration.

Development builds now run `npm run build:server` before Vite. Install source dependencies for both root and `server` first. The development Tauri executable can launch the repository server via `node`; packaged versions use the bundled Node binary. Running the frontend by itself in an ordinary web browser does not start the local Chelys daemon.

The richer local UI methods (`storage.sync/mutate`, `account.credentials/collaborators`, `recipes.snapshot/save/variables.set/engine.set/cancelInstall/reinject/collaborators/registry.refresh`) are dispatched by the same control handler but **cannot be invoked by remote API keys**. Local PRF reads do not disclose the account password. Remote permission policies remain enforced on the existing commands.

### Service lifecycle

| Command | Operation |
| --- | --- |
| `chelys serve` | Headless runtime in foreground |
| `chelys serve --detach` | Start a background process; verify its RPC readiness before reporting success |
| `chelys runtime show` | Read preferred mode and active owner, even if the backend is stopped |
| `chelys runtime stop` | Gracefully stop the running local backend (no effect if already stopped; an open desktop may restart it) |
| `chelys runtime preference [MODE]` | Read/set desired owner without connecting to a backend: `automatic`, `desktop`, `headless` |
| `chelys serve --ws-port PORT` | Enable loopback-only WebSocket control |
| `chelys shell` | Interactive CLI client |
| `chelys status` | Local account/runtime state |
| `chelys credentials check` | Credential backend and keyring recovery status |

In **Automatic** mode the desktop attaches to an existing service or starts one that persists after the UI closes. In **Desktop-managed** mode only the desktop starts the backend; the backend identifies itself as `desktop`, serves the CLI normally while open, and stops when the owning desktop process exits (including unexpected termination). In **Headless** mode `chelys serve` can start independently and persist without the desktop. A running service is not forcibly replaced merely by selecting a preference; use **Apply mode and restart backend** in Settings or `chelys runtime stop` from the CLI to shut it down gracefully. Running recipes will be restarted from their saved intent on the next startup. If startup fails, the desktop recovery view can retry without restarting the app. For offline recovery, run `chelys runtime preference automatic` (or `node server/cli.mjs runtime preference automatic` from a source checkout) and retry.

Local RPC is newline-delimited JSON over a private Unix socket (`0600`) or a Windows named pipe. Only one controller owns a profile; a second daemon is rejected. The Windows Store CLI alias and desktop sidecar run the same embedded runtime.

### Environment

| Variable | Meaning |
| --- | --- |
| `CHELYS_DATA_DIR` | Instance data directory, defaulting to `XDG_DATA_HOME/chelys` or `~/.local/share/chelys` |
| `CHELYS_CREDENTIAL_ID` | OS credential account identifier; `default` unless set |
| `CHELYS_CREDENTIAL_HELPER` | Override native helper executable path |
| `CHELYS_USERNAME` | Login username default |
| `CHELYS_PRF` | Login PRF in hexadecimal bytes |
| `CHELYS_LOGIN_PASSWORD` | Password environment variable for unattended login (use `--password-env`) |
| `CHELYS_PEER` | Default remote peer target |
| `CHELYS_REMOTE_KEY` | Default remote authorization key |
| `CHELYS_SIGNALING_ORIGIN` | Override the headless signaling WebSocket `Origin` header |

Independent instances should use distinct `CHELYS_DATA_DIR` and `CHELYS_CREDENTIAL_ID` values. The headless signaling origin defaults to `http://localhost:5173` and is configured by `userdata.default.settings.headlessSignalingOrigin` in `chelys.config.ts`. It is applied to configured y-webrtc and y-websocket endpoints, including room paths, and to FilePizza WebSockets if used. Recipe-service WebSockets are unaffected. Settings are read when a signaling connection opens; changes to `chelys.config.ts` require rebuilding the server runtime.

## Credentials and accounts

| Command | Operation |
| --- | --- |
| `chelys login --username USER --prf HEX` | Login using direct PRF argument; password prompted without echo |
| `chelys login --username USER --prf-file PATH` | Read PRF from file; password prompted without echo |
| `chelys login --username USER --generate-prf` | Generate and store a cryptographically random 32-byte PRF; password prompted without echo |
| `chelys login ... --show-prf` | Include the saved PRF in the successful login result |
| `chelys --show-prf` | Print the locally saved PRF without requiring the daemon; use `--json` for structured output |
| `chelys status --show-prf`, `chelys account show --show-prf`, `chelys profile show --show-prf` | Include the locally saved PRF in the command result |
| `chelys login ... --password-env NAME` | Read password from named environment variable |
| `chelys login ... --password-stdin` | Read password from standard input |
| `chelys logout` | Clear the active account and saved credentials |
| `chelys account show` | Account status |
| `chelys profile show` | Instance profile |
| `chelys profile set name VALUE` | Set instance display name |
| `chelys profile update --username USER --prf-file PATH --password-env NAME` | Update account credentials; accepts `--prf HEX` or `--generate-prf` instead of `--prf-file` |
| `chelys profile update --generate-prf --show-prf` | Generate, apply and display a replacement PRF for the logged-in account |
| `chelys profile rotate-prf` | Generate and apply a replacement PRF/room identity; returns the generated PRF |

PRF changes select a different account room; access to the previous room requires its original PRF. `--show-prf` is local-only and exposes sensitive identity material on stdout. `--generate-prf` is mutually exclusive with explicit `--prf` and `--prf-file` arguments.

The native credential store uses Windows Credential Manager, macOS Keychain, or Linux Secret Service. When unavailable or locked, `account.json` is used as a **plaintext fallback**, with a security warning in the CLI and desktop UI. The fallback is stored in the private instance directory and is migrated automatically after a verified keyring write. Logout uses a non-secret marker when keyring deletion is unavailable to prevent restoration of stale credentials. Fallback files and backups must be treated as sensitive.

Windows services must run under the appropriate credential-store user. macOS headless processes require an accessible user Keychain. Linux Secret Service requires an available D-Bus session and unlocked provider; otherwise the warned fallback is used.

## CLI command surface

The local control socket is the default target. `--peer TARGET` selects a remote Chelys instance; `--local` overrides a saved target. `--api-key-env NAME` supplies a remote key. `--json` produces compact JSON; `--reveal` permits displaying secret or environment values normally redacted by the CLI. String values are parsed as JSON when valid; `-` reads the value from standard input.

| Resource | Commands |
| --- | --- |
| Chelys settings | `settings list`, `settings get KEY`, `settings set KEY JSON`, `settings delete KEY` |
| TeXlyre settings | `account settings list|get|set|delete [KEY] [JSON]` |
| TeXlyre properties | `account properties list|get|set|delete [KEY] [JSON]` |
| TeXlyre records | `account records list|get|set|delete [KEY] [JSON]`, `append KEY JSON`, `remove KEY RECORD_ID` |
| TeXlyre secrets | `account secrets list|get|set|delete [KEY] [VALUE]` |
| Recipe inventory | `recipes list`, `recipes registry`, `recipes add ID [--version VERSION]`, `recipes inspect ID`, `recipes logs ID` |
| Recipe lifecycle | `recipes import PATH`, `recipes install ID MODE [--source registry|build] [--engine docker|podman] [--version VERSION] [--initialize-volumes]`, `recipes run|stop|restart|uninstall|remove ID` |
| Recipe attributes | `recipes set ID FIELD JSON`, `recipes env list|get|set|delete ID [KEY] [VALUE]` |
| Inspection | `recipes metrics ID [--fields FIELDS]`, `recipes share ID show|set MODE [--fields FIELDS]` |
| Access policy | `access show`, `access mode disabled|peers|keys` |
| API keys | `access keys list`, `access keys create NAME PERMISSION[,PERMISSION...] [--fields FIELDS]`, `access keys revoke ID` |
| Peers | `peers list`, `peers inspect TARGET`, `peers connect ALIAS wss://HOST/control`, `peers disconnect ALIAS`, `peers use TARGET|local` |
| Machine | `machine show` |

`MODE` is `system`, `docker`, or `connect` for installations. `recipes add` resolves a recipe ID and optional version from the configured registry using the same manager as the desktop. `recipes install` automatically registers missing recipes from that registry. For `docker` mode, `--source registry` pulls the published image; `--source build` uses the recipe Dockerfile/build steps. `--engine` sets a per-recipe container-engine override. `--initialize-volumes` explicitly authorizes creation of new storage volumes. Recipe attribute fields are `name`, `notes`, `cwd`, `backend`, or `typeConfig.KEY`, `env.KEY`, `variableValues.KEY`. Attribute/environment changes may require a recipe restart.

Recipe autostart uses `active-recipes.json` in the instance data directory: successful `recipes run`/`recipes restart` commands add a recipe, and explicit `recipes stop`/`recipes uninstall`/`recipes remove` commands remove it. An ordinary backend shutdown does **not** clear this intent. At the next startup Chelys restores the list: it reuses an already-running Docker/Podman container, attaches to a stopped container with the same managed recipe name, or creates a new container if absent. This avoids container-name collisions without deleting volumes or using `--replace`. Restarting a stopped existing container retains that container's original configuration; remove/recreate it deliberately when changes to image, port mappings, or environment must take effect. If the engine cannot inspect a container, Chelys reports an error rather than treating it as missing.

In the Tauri desktop, the **Hide to system tray** close mode hides the native window and restores it from the tray icon/menu, provided a tray icon exists. **Quit desktop UI** closes the interface but leaves the shared backend running for CLI and remote clients. The standalone headless server does not require a desktop window or tray.


### Storage namespaces

| Data | CLI namespace | Local-storage key | Remote permission family |
| --- | --- | --- | --- |
| Chelys settings | `settings` | `chelys-user-{accountId}-settings` | `chelys.settings.read/write` |
| TeXlyre settings | `account settings` | `texlyre-user-{accountId}-settings` | `texlyre.settings.read/write` |
| TeXlyre properties | `account properties` | `texlyre-user-{accountId}-properties` | `texlyre.properties.read/write` |
| TeXlyre records | `account records` | `texlyre-user-{accountId}-records` | `texlyre.records.read/write` |
| TeXlyre secrets | `account secrets` | `texlyre-user-{accountId}-secrets` | `texlyre.secrets.read/write` |
| Instance profile | `profile` | Instance metadata | `instance.profile.read/edit` |

There is no separate Chelys properties store. TeXlyre account stores preserve their existing synchronization format. Record values are arrays of `{id, timestamp, data}` entries; `append` creates the entry metadata. Secret identifiers are `pluginId:global:key` or `pluginId:project:projectId:key`. Secret values use TeXlyre's existing password-derived encryption format. Remote plaintext secret retrieval requires `texlyre.secrets.read` and explicit `--reveal` for CLI output.

```sh
chelys settings set defaultContainerEngine '"podman"'
chelys account properties set editorTheme:global '"dark"'
chelys account records append activity:global '{"state":"started"}'
printf '%s' "$TOKEN" | chelys account secrets set github:global:token -
chelys recipes install garage-storage docker --source registry --engine podman --initialize-volumes
chelys recipes run garage-storage
chelys recipes install system-monitor system
chelys recipes run system-monitor
```

## Remote API

All control operations use a shared versioned JSON request/response envelope. The method names match those in `src/control/commands.ts`.

```json
{"v":1,"id":"8f467f19-4fba-41be-af21-fd262a453e6e","method":"recipes.list","params":{},"apiKey":"chlys_..."}
```

```json
{"v":1,"id":"8f467f19-4fba-41be-af21-fd262a453e6e","ok":true,"result":[]}
```

Local RPC is newline-delimited JSON over the private Unix socket or Windows named pipe. The optional WebSocket listener binds to `127.0.0.1` only; remote access requires a trusted TLS reverse proxy or secure tunnel. WebRTC uses the existing TeXlyre/Yjs account-room advertisement and service-session transport with the label `chelys-control:<instance-id>`. WebRTC messages use existing service-channel framing. Limits: 64 KiB per request and 512 KiB per response.

### Authorization

| Access mode | Effect |
| --- | --- |
| `disabled` | No advertised WebRTC control service; remote operations denied |
| `peers` | Verified account-room WebRTC peers may control ordinary recipes; account stores and privileged infrastructure operations are excluded |
| `keys` | API key required; each operation checks its explicit permission and optional telemetry-field restrictions |

`peers` mode does not grant access to Chelys/TeXlyre settings, properties, records, secrets, or instance-profile edits. WebSocket callers must use key mode. Login/logout, credential updates, API-key administration, sharing-policy changes, and endpoint configuration are always local-only. Keys are displayed only on creation, stored as SHA-256 hashes, and revocable.

| Permission family | Operations |
| --- | --- |
| `inventory.read`, `machine.read` | Instance metadata and machine inventory |
| `recipes.read`, `recipes.logs`, `recipes.telemetry.read` | Recipe inventory, logs, and permitted telemetry |
| `recipes.edit`, `recipes.install`, `recipes.run`, `recipes.remove` | Ordinary recipe changes and lifecycle |
| `infrastructure.manage`, `infrastructure.logs` | Additional authorization for privileged infrastructure operations and logs |
| `chelys.settings.read/write`, `instance.profile.read/edit` | Instance configuration |
| `texlyre.{settings,properties,records,secrets}.read/write` | Individual TeXlyre account stores |

Remote recipe lifecycle responses expose state and install mode, not process logs or environment values. Infrastructure operations require `infrastructure.manage` **in addition** to the corresponding recipe permission; an API key must explicitly grant it. Telemetry requires both authorization and a per-recipe sharing policy.

### Remote targets

```sh
chelys peers list
chelys peers connect server-a wss://chelys.example.org/control
chelys --peer server-a --api-key-env CHELYS_REMOTE_KEY recipes inspect system-monitor
chelys peers use server-a
chelys recipes list
chelys --local recipes list
chelys peers use local
```

Discovered WebRTC peers and configured WebSocket endpoints are distinct. Presence or a saved endpoint is not proof of current reachability; explicit inspection tests the connection. Account Settings → Remote Control provides the same policy, key, connection and inspection operations as the CLI.

## Infrastructure inspection

`system-monitor` is an infrastructure recipe with `system` and `docker` modes. It reports on-demand snapshots through the existing recipe logs and optional `inspectRecipe` capability. No separate monitoring daemon or database is required.

| Field | Data |
| --- | --- |
| `cpu` | Utilization and core count |
| `memory` | RAM usage and capacity |
| `storage` | Volume capacity and free space |
| `network` | Network counters/throughput where supported |
| `gpu` | GPU and VRAM data where drivers permit |
| `temperatures` | Supported thermal sensor readings |
| `energy` | Available energy counters; not inferred power draw |
| `process` | Collector process information only |

Unsupported metrics are `null`. Snapshots are sampled every five seconds and considered stale after 20 seconds. Container mode is restricted to its container view; it does not mount the Docker socket or grant host privileges. Higher-risk sensor access requires explicit collector deployment permissions.

```sh
chelys recipes metrics system-monitor --fields cpu,memory,gpu
chelys recipes share system-monitor show
chelys recipes share system-monitor set keys --fields cpu,memory
chelys access mode keys
chelys access keys create observer inventory.read,recipes.read,recipes.telemetry.read --fields cpu,memory
chelys --peer server-a --api-key-env CHELYS_REMOTE_KEY recipes metrics system-monitor --fields cpu
chelys recipes share system-monitor set disabled
```

Sharing is disabled by default. The recipe's sharing mode and selected fields limit disclosure independently of the peer's key permissions. Remote key revocation and disabled sharing take effect on subsequent requests.

## Deployment

### systemd

`server/chelys.service` is a user-service template. Set `ExecStart` to the installed Chelys server launcher; run under the user that owns the keychain and data directory.

```sh
install -m 0644 server/chelys.service ~/.config/systemd/user/chelys.service
systemctl --user daemon-reload
systemctl --user enable --now chelys
```

### Docker

```sh
docker build -f server/Dockerfile -t chelys:headless .
docker run --rm -v chelys-data:/var/lib/chelys chelys:headless
```

The image includes the native Rust credential helper and runs as an unprivileged user. A container without access to an unlocked OS keyring uses the warned plaintext fallback in its private volume. Containers that run Docker recipes require separately configured container-engine access; no host Docker socket is mounted by default.

### Verification

```sh
npm run typecheck
npm test
npm run test:server
npm run build
npm run build:server
```

Native OS keychain integration, host networking, WebRTC interoperability, and container-engine deployment must be tested on each supported target operating system.
