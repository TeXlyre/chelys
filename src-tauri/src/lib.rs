use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use uuid::Uuid;
mod webrtc_bridge;
use webrtc_bridge::WebRtcRegistry;
mod process_supervisor;
use process_supervisor::ProcessSupervisor;
mod tray;

const SERVICE: &str = "app.chelys.poc";
const USER: &str = "default";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredCredentials {
    username: String,
    password: String,
    prf_output_hex: String,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
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

fn entry() -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE, USER)
}

#[tauri::command]
fn save_credentials(
    username: String,
    password: String,
    prf_output_hex: String,
) -> Result<(), AppError> {
    let creds = StoredCredentials {
        username,
        password,
        prf_output_hex,
    };
    let json = serde_json::to_string(&creds)?;
    entry()?.set_password(&json)?;
    Ok(())
}

#[tauri::command]
fn load_credentials() -> Result<Option<StoredCredentials>, AppError> {
    match entry()?.get_password() {
        Ok(json) => Ok(Some(serde_json::from_str(&json)?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
fn clear_credentials() -> Result<(), AppError> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
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
fn generate_peer_id() -> String {
    format!("peer-{}", Uuid::new_v4().simple())
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
    let supervisor = ProcessSupervisor::default();
    let shutdown = supervisor.clone();

    tauri::Builder::default()
        .manage(WebRtcRegistry::default())
        .manage(supervisor)
        .manage(CloseBehaviorState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            tray::build(app.handle())?;
            if std::env::args().any(|arg| arg == "--hidden") {
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
                if behavior == CloseBehavior::Tray {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            load_credentials,
            clear_credentials,
            set_close_behavior,
            generate_peer_id,
            fs_exists,
            fs_read,
            fs_write,
            fs_mkdir,
            fs_remove,
            fs_rename,
            fs_stat,
            path_join,
            webrtc_bridge::rtc_create_peer,
            webrtc_bridge::rtc_create_data_channel,
            webrtc_bridge::rtc_create_offer,
            webrtc_bridge::rtc_create_answer,
            webrtc_bridge::rtc_set_local_description,
            webrtc_bridge::rtc_set_remote_description,
            webrtc_bridge::rtc_add_ice_candidate,
            webrtc_bridge::rtc_close_peer,
            webrtc_bridge::rtc_channel_send_string,
            webrtc_bridge::rtc_channel_send_binary,
            webrtc_bridge::rtc_channel_close,
            process_supervisor::process_run_command,
            process_supervisor::process_spawn,
            process_supervisor::process_stop,
            process_supervisor::process_is_running,
            process_supervisor::process_list_running,
        ])
        .build(tauri::generate_context!())
        .expect("...")
        .run(move |_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let shutdown = shutdown.clone();
                tauri::async_runtime::block_on(async move {
                    shutdown.shutdown_all().await;
                });
            }
        });
}
