// src-tauri/src/lib.rs
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
mod instance;
mod ownership;
mod tray;

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("credential store: {0}")]
    Credential(String),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum CloseBehavior {
    Tray,
    Exit,
}

#[derive(Default)]
struct CloseBehaviorState(Mutex<Option<CloseBehavior>>);

fn credential_directory() -> Result<PathBuf, AppError> {
    if let Some(value) = std::env::var_os("CHELYS_DATA_DIR").filter(|value| !value.is_empty()) {
        let directory = PathBuf::from(value);
        if !directory.is_absolute() {
            return Err(AppError::Credential("CHELYS_DATA_DIR must be an absolute path".into()));
        }
        return Ok(directory);
    }

    let base = if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|value| !value.is_empty()) {
        PathBuf::from(xdg)
    } else {
        std::env::home_dir()
            .ok_or_else(|| AppError::Credential("Home directory unavailable".into()))?
            .join(".local")
            .join("share")
    };
    if !base.is_absolute() {
        return Err(AppError::Credential("Credential data directory must be absolute".into()));
    }
    Ok(base.join("chelys"))
}

// Resolve the same local preference before creating any desktop windows.
// Invalid preferences open the desktop recovery UI instead of silently failing at login.
pub fn autostart_headless() -> bool {
    credential_directory()
        .map_err(|error| error.to_string())
        .and_then(|directory| ownership::read(&directory))
        .is_ok_and(|mode| mode != ownership::OwnerMode::Desktop)
}

#[tauri::command]
fn set_close_behavior(state: tauri::State<'_, CloseBehaviorState>, exit_on_close: bool) {
    *state.0.lock().unwrap() = Some(if exit_on_close {
        CloseBehavior::Exit
    } else {
        CloseBehavior::Tray
    });
}

#[tauri::command]
fn fs_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

#[tauri::command]
fn fs_read(path: String) -> Result<Vec<u8>, AppError> {
    Ok(std::fs::read(path)?)
}

#[tauri::command]
fn fs_write(path: String, contents: Vec<u8>) -> Result<(), AppError> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)?;
    Ok(())
}

#[tauri::command]
fn fs_mkdir(path: String) -> Result<(), AppError> {
    std::fs::create_dir_all(path)?;
    Ok(())
}

#[tauri::command]
fn fs_remove(path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p)?;
    } else {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

#[tauri::command]
fn fs_rename(from: String, to: String) -> Result<(), AppError> {
    if let Some(parent) = PathBuf::from(&to).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

#[derive(Serialize)]
struct StatInfo {
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn fs_stat(path: String) -> Result<StatInfo, AppError> {
    let meta = std::fs::metadata(path)?;
    Ok(StatInfo {
        is_dir: meta.is_dir(),
        size: meta.len(),
    })
}

#[tauri::command]
fn path_join(parts: Vec<String>) -> String {
    let mut buf = PathBuf::new();
    for part in parts {
        buf.push(part);
    }
    buf.to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CloseBehaviorState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let directory = credential_directory().map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let instance = instance::initialize(app.handle(), directory)
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(instance);
            tray::build(app.handle())?;
            if std::env::args().any(|arg| arg == "--hidden" || arg == "--autostart") && app.tray_by_id("main").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<CloseBehaviorState>();
                let behavior = state.0.lock().unwrap().unwrap_or(CloseBehavior::Tray);
                if behavior == CloseBehavior::Tray && window.app_handle().tray_by_id("main").is_some() {
                    if window.hide().is_ok() {
                        api.prevent_close();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            instance::instance_mode,
            instance::instance_retry,
            instance::instance_restart,
            instance::instance_owner_get,
            instance::instance_owner_set,
            instance::instance_rpc,
            instance::instance_install_cli,
            set_close_behavior,
            fs_exists,
            fs_read,
            fs_write,
            fs_mkdir,
            fs_remove,
            fs_rename,
            fs_stat,
            path_join,
        ])
        .build(tauri::generate_context!())
        .expect("...")
        .run(move |_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                instance::cleanup(&_app.state::<instance::InstanceState>());
            }
        });
}
