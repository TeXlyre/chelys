// src-tauri/src/instance.rs
use crate::ownership::{self, OwnerMode, StartupClaim};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[path = "../../native/runtime_locator.rs"]
mod runtime_locator;

const MAX_MESSAGE: usize = 2_097_152;
const MAX_RESPONSE: usize = 8_388_608;

pub struct InstanceState {
    started_mode: Mutex<OwnerMode>,
    issue: Mutex<Option<String>>,
    pub socket: String,
    pub directory: PathBuf,
    recovery: tokio::sync::Mutex<()>,
}

fn socket_path(directory: &Path) -> String {
    #[cfg(windows)]
    {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(directory.to_string_lossy().as_bytes());
        let id: String = digest[..10]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        format!(r"\\.\pipe\chelys-{id}")
    }
    #[cfg(not(windows))]
    {
        directory.join("chelys.sock").to_string_lossy().into_owned()
    }
}

#[derive(Debug)]
enum RpcFailure {
    Connection(std::io::Error),
    Other(String),
}

impl RpcFailure {
    fn recoverable(&self) -> bool {
        matches!(self, Self::Connection(error) if matches!(
            error.kind(),
            std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
        ))
    }

    fn message(self) -> String {
        match self {
            Self::Connection(error) => error.to_string(),
            Self::Other(message) => message,
        }
    }
}

async fn request(socket: &str, message: String) -> Result<Value, RpcFailure> {
    if message.len() > MAX_MESSAGE {
        return Err(RpcFailure::Other("RPC request too large".into()));
    }
    #[cfg(unix)]
    let stream = tokio::net::UnixStream::connect(socket)
        .await
        .map_err(RpcFailure::Connection)?;
    #[cfg(windows)]
    let stream = tokio::net::windows::named_pipe::ClientOptions::new()
        .open(socket)
        .map_err(RpcFailure::Connection)?;
    let (read, mut write) = tokio::io::split(stream);
    write
        .write_all(message.as_bytes())
        .await
        .map_err(|error| RpcFailure::Other(error.to_string()))?;
    write
        .write_all(b"\n")
        .await
        .map_err(|error| RpcFailure::Other(error.to_string()))?;
    let mut reader = BufReader::new(read);
    let mut line = String::new();
    let count = tokio::time::timeout(Duration::from_secs(45), reader.read_line(&mut line))
        .await
        .map_err(|_| RpcFailure::Other("RPC request timed out".into()))?
        .map_err(|error| RpcFailure::Other(error.to_string()))?;
    if count == 0 || line.len() > MAX_RESPONSE {
        return Err(RpcFailure::Other(
            "RPC response missing or too large".into(),
        ));
    }
    serde_json::from_str(&line).map_err(|error| RpcFailure::Other(error.to_string()))
}

async fn command(socket: &str, method: &str, params: Value) -> Result<Value, RpcFailure> {
    let message = json!({ "v": 1, "id": uuid::Uuid::new_v4().to_string(), "method": method, "params": params });
    let response = request(socket, message.to_string()).await?;
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(RpcFailure::Other(
            response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("RPC request failed")
                .to_string(),
        ))
    }
}

fn runtime_ready(socket: &str) -> bool {
    tauri::async_runtime::block_on(async {
        matches!(
            tokio::time::timeout(
                Duration::from_millis(350),
                command(socket, "instance.runtime", json!({}))
            )
            .await,
            Ok(Ok(_))
        )
    })
}

fn migrate_recipe_store(app: &AppHandle, directory: &Path) -> Result<(), String> {
    let old = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("chelys-recipes.json");
    let new = directory.join("chelys-recipes.json");
    if !new.exists() && old.is_file() && old != new {
        fs::copy(&old, &new).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&new, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn spawn_backend(directory: &Path, socket: &str, mode: OwnerMode) -> Result<(), String> {
    if runtime_ready(socket) {
        return Ok(());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let (node, cli) = match runtime_locator::find_runtime(&executable) {
        Ok(runtime) => {
            let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
            let cli = runtime.join("server/cli.mjs");
            if !node.is_file() || !cli.is_file() {
                return Err("Bundled Chelys runtime incomplete; reinstall Chelys".into());
            }
            (node, cli)
        }
        Err(error) => {
            #[cfg(debug_assertions)]
            {
                // Dev builds use the source runtime, never require an installed sidecar.
                let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .ok_or_else(|| error.clone())?;
                let cli = root.join("server/cli.mjs");
                if !cli.is_file() || !root.join("server/dist/runtime.mjs").is_file() {
                    return Err(
                        "Build the development backend with npm run build:server:runtime".into(),
                    );
                }
                (PathBuf::from("node"), cli)
            }
            #[cfg(not(debug_assertions))]
            {
                return Err(error);
            }
        }
    };
    let logfile = directory.join("headless-startup.log");
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let log = options.open(&logfile).map_err(|error| error.to_string())?;
    let mut process = Command::new(node);
    process
        .arg(cli)
        .arg("serve")
        .env("CHELYS_DATA_DIR", directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            log.try_clone().map_err(|error| error.to_string())?,
        ))
        .stderr(Stdio::from(log));
    if mode == OwnerMode::Desktop {
        process.env("CHELYS_DESKTOP_MANAGED", "1")
            .env("CHELYS_DESKTOP_PID", std::process::id().to_string());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = process
        .spawn()
        .map_err(|error| format!("Cannot start Chelys backend: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if runtime_ready(socket) {
            return Ok(());
        }
        if let Some(exit) = child.try_wait().map_err(|error| error.to_string())? {
            if runtime_ready(socket) {
                return Ok(());
            }
            return Err(format!(
                "Chelys backend exited with {exit}; see {}",
                logfile.display()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
    if runtime_ready(socket) {
        return Ok(());
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(format!(
        "Chelys backend did not become ready; see {}",
        logfile.display()
    ))
}

pub fn initialize(app: &AppHandle, directory: PathBuf) -> Result<InstanceState, String> {
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    let socket = socket_path(&directory);
    let state = InstanceState {
        started_mode: Mutex::new(OwnerMode::Automatic),
        issue: Mutex::new(None),
        socket,
        directory,
        recovery: tokio::sync::Mutex::new(()),
    };
    let preference = match ownership::read(&state.directory) {
        Ok(value) => value,
        Err(error) => {
            *state.issue.lock().unwrap() = Some(error);
            return Ok(state);
        }
    };
    *state.started_mode.lock().unwrap() = preference;
    if let Err(error) = migrate_recipe_store(app, &state.directory)
        .and_then(|_| spawn_backend(&state.directory, &state.socket, preference)) {
        *state.issue.lock().unwrap() = Some(error);
    }
    Ok(state)
}

#[tauri::command]
pub fn instance_mode(state: tauri::State<'_, InstanceState>) -> &'static str {
    if state.issue.lock().unwrap().is_some() {
        "unavailable"
    } else {
        "attached"
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerStatus {
    preference: &'static str,
    active: &'static str,
    restart_required: bool,
    issue: Option<String>,
}

#[tauri::command]
pub async fn instance_owner_get(state: tauri::State<'_, InstanceState>) -> Result<OwnerStatus, String> {
    // Even a corrupt preference must leave the recovery control usable.
    let (preference, read_issue) = match ownership::read(&state.directory) {
        Ok(mode) => (mode, None),
        Err(error) => (OwnerMode::Automatic, Some(error)),
    };
    let active = tokio::time::timeout(
        Duration::from_millis(700),
        command(&state.socket, "instance.runtime", json!({})),
    ).await.ok().and_then(Result::ok)
        .and_then(|value| value.get("kind").and_then(Value::as_str).map(str::to_owned));
    Ok(OwnerStatus {
        preference: preference.label(),
        active: match active.as_deref() {
            Some("desktop") => "desktop",
            Some("headless") => "headless",
            _ => "unavailable",
        },
        restart_required: preference != *state.started_mode.lock().unwrap()
            || (preference == OwnerMode::Desktop && active.as_deref() == Some("headless"))
            || (preference != OwnerMode::Desktop && active.as_deref() == Some("desktop")),
        issue: read_issue.or_else(|| state.issue.lock().unwrap().clone()),
    })
}

#[tauri::command]
pub async fn instance_owner_set(
    state: tauri::State<'_, InstanceState>,
    mode: OwnerMode,
) -> Result<OwnerStatus, String> {
    let directory = state.directory.clone();
    tokio::task::spawn_blocking(move || {
        let _claim = StartupClaim::acquire(&directory)?;
        ownership::write(&directory, mode)
    }).await.map_err(|error| error.to_string())??;
    instance_owner_get(state).await
}

// Used by the recovery screen and by disconnected RPC calls. This does not
// require a live backend, and applies the *current* on-disk preference.
async fn recover_backend(state: &InstanceState, app: &AppHandle) -> Result<(), String> {
    let directory = state.directory.clone();
    let socket = state.socket.clone();
    let app = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mode = ownership::read(&directory)?;
        migrate_recipe_store(&app, &directory)?;
        spawn_backend(&directory, &socket, mode)?;
        Ok::<_, String>(mode)
    }).await.map_err(|error| format!("Backend recovery task failed: {error}"))
        .and_then(|result| result);
    match result {
        Ok(mode) => {
            *state.started_mode.lock().unwrap() = mode;
            *state.issue.lock().unwrap() = None;
            Ok(())
        }
        Err(error) => {
            *state.issue.lock().unwrap() = Some(error.clone());
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn instance_retry(
    app: AppHandle,
    state: tauri::State<'_, InstanceState>,
) -> Result<(), String> {
    let _recovery = state.recovery.lock().await;
    recover_backend(&state, &app).await
}

#[tauri::command]
pub async fn instance_restart(
    app: AppHandle,
    state: tauri::State<'_, InstanceState>,
) -> Result<(), String> {
    let _recovery = state.recovery.lock().await;
    // Validate the selected mode before interrupting any live backend.
    ownership::read(&state.directory)?;
    let running = command(&state.socket, "instance.runtime", json!({})).await.ok();
    if let Some(previous) = running {
        command(&state.socket, "instance.shutdown", json!({})).await
            .map_err(RpcFailure::message)?;
        // Wait for graceful recipe shutdown and socket release, not just the ACK.
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let probe = tokio::time::timeout(
                Duration::from_millis(500),
                command(&state.socket, "instance.runtime", json!({})),
            ).await;
            let released = match &probe {
                Ok(Err(error)) if error.recoverable() => true,
                Ok(Ok(value)) if value.get("pid") != previous.get("pid") => true,
                _ => false,
            };
            if released { break; }
            if Instant::now() >= deadline {
                return Err("Backend did not stop within 30 seconds. Retry after it finishes shutting down.".into());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    recover_backend(&state, &app).await
}

#[tauri::command]
pub async fn instance_rpc(
    app: AppHandle,
    state: tauri::State<'_, InstanceState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    match command(&state.socket, &method, params.clone()).await {
        Ok(result) => return Ok(result),
        Err(error) if !error.recoverable() => return Err(error.message()),
        Err(_) => {}
    }

    let _recovery = state.recovery.lock().await;
    // A concurrent request might have already reconnected to the same service.
    let disconnected = match command(&state.socket, "instance.runtime", json!({})).await {
        Ok(_) => false,
        Err(error) if error.recoverable() => true,
        Err(error) => return Err(error.message()),
    };
    if disconnected { recover_backend(&state, &app).await?; }
    command(&state.socket, &method, params)
        .await
        .map_err(RpcFailure::message)
}

#[tauri::command]
pub fn instance_install_cli(app: AppHandle) -> Result<String, String> {
    if std::env::var_os("FLATPAK_ID").is_some() {
        return Err("Use flatpak run --command=chelys-runtime io.github.texlyre.chelys from the host terminal".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let folder = executable
            .parent()
            .ok_or("Application directory unavailable")?;
        let launcher = folder.join("chelys-runtime");
        if !launcher.is_file() {
            return Err("Install the packaged Chelys application first".into());
        }
        let dir = app
            .path()
            .home_dir()
            .map_err(|error| error.to_string())?
            .join(".local/bin");
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let link = dir.join("chelys");
        if link.exists() || link.symlink_metadata().is_ok() {
            if fs::canonicalize(&link).ok().as_ref() != fs::canonicalize(&launcher).ok().as_ref() {
                return Err(format!(
                    "{} already exists and is not the Chelys CLI",
                    link.display()
                ));
            }
        } else {
            symlink(&launcher, &link).map_err(|error| error.to_string())?;
        }
        Ok(link.to_string_lossy().into_owned())
    }
    #[cfg(windows)]
    {
        let _ = app;
        Err(
            "Use the Microsoft Store execution alias or the packaged chelys-runtime.exe executable"
                .into(),
        )
    }
}

pub fn cleanup(_state: &InstanceState) {
    // The shared daemon survives closing the UI; CLI and remote clients remain connected.
}
