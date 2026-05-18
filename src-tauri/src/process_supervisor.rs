use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProcessEvent {
    handle_id: String,
    stream: String,
    line: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    handle_id: String,
    status: String,
    exit_code: Option<i32>,
}

#[derive(Default)]
struct SupervisorInner {
    servers: Mutex<HashMap<String, Child>>,
}

#[derive(Clone, Default)]
pub struct ProcessSupervisor {
    inner: Arc<SupervisorInner>,
}

impl ProcessSupervisor {
    pub async fn shutdown_all(&self) {
        let mut servers = self.inner.servers.lock().await;
        for (_, mut child) in servers.drain() {
            let _ = child.kill().await;
        }
    }
}

fn build_command(spec: &CommandSpec) -> Command {
    let mut cmd = Command::new(&spec.command);
    cmd.args(&spec.args);
    for (key, value) in &spec.env {
        cmd.env(key, value);
    }
    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    cmd
}

fn stream_output(app: AppHandle, handle_id: String, child: &mut Child) {
    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let id = handle_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "process-output",
                    ProcessEvent {
                        handle_id: id.clone(),
                        stream: "stdout".into(),
                        line,
                    },
                );
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let id = handle_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    "process-output",
                    ProcessEvent {
                        handle_id: id.clone(),
                        stream: "stderr".into(),
                        line,
                    },
                );
            }
        });
    }
}

#[tauri::command]
pub async fn process_run_command(
    app: AppHandle,
    handle_id: String,
    spec: CommandSpec,
) -> Result<i32, String> {
    let mut child = build_command(&spec).spawn().map_err(|e| e.to_string())?;
    stream_output(app.clone(), handle_id.clone(), &mut child);
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let code = status.code().unwrap_or(-1);
    let _ = app.emit(
        "process-status",
        StatusEvent {
            handle_id,
            status: if status.success() { "exited".into() } else { "failed".into() },
            exit_code: Some(code),
        },
    );
    Ok(code)
}

#[tauri::command]
pub async fn process_spawn(
    app: AppHandle,
    supervisor: State<'_, ProcessSupervisor>,
    handle_id: String,
    spec: CommandSpec,
) -> Result<(), String> {
    let mut servers = supervisor.inner.servers.lock().await;
    if servers.contains_key(&handle_id) {
        return Err("process already running".to_string());
    }

    let mut child = build_command(&spec).spawn().map_err(|e| e.to_string())?;
    stream_output(app.clone(), handle_id.clone(), &mut child);
    servers.insert(handle_id.clone(), child);

    let _ = app.emit(
        "process-status",
        StatusEvent {
            handle_id,
            status: "running".into(),
            exit_code: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn process_stop(
    app: AppHandle,
    supervisor: State<'_, ProcessSupervisor>,
    handle_id: String,
) -> Result<(), String> {
    let mut servers = supervisor.inner.servers.lock().await;
    if let Some(mut child) = servers.remove(&handle_id) {
        child.kill().await.map_err(|e| e.to_string())?;
    }
    let _ = app.emit(
        "process-status",
        StatusEvent {
            handle_id,
            status: "stopped".into(),
            exit_code: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn process_is_running(
    supervisor: State<'_, ProcessSupervisor>,
    handle_id: String,
) -> Result<bool, String> {
    let servers = supervisor.inner.servers.lock().await;
    Ok(servers.contains_key(&handle_id))
}

#[tauri::command]
pub async fn process_list_running(
    supervisor: State<'_, ProcessSupervisor>,
) -> Result<Vec<String>, String> {
    let servers = supervisor.inner.servers.lock().await;
    Ok(servers.keys().cloned().collect())
}
