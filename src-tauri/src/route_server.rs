use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(serde::Serialize)]
pub struct RouteServerHandle {
    token: String,
    port: u16,
}

#[derive(Clone)]
pub struct RouteServerState {
    config: Arc<Mutex<Value>>,
    token: Arc<OnceLock<String>>,
    port: Arc<OnceLock<u16>>,
    started: Arc<AtomicBool>,
}

impl Default for RouteServerState {
    fn default() -> Self {
        Self {
            config: Arc::new(Mutex::new(json!({
                "http": {
                    "services": {
                        "chelys-placeholder": {
                            "loadBalancer": { "servers": [{ "url": "http://127.0.0.1:1" }] }
                        }
                    }
                }
            }))),
            token: Arc::new(OnceLock::new()),
            port: Arc::new(OnceLock::new()),
            started: Arc::new(AtomicBool::new(false)),
        }
    }
}

async fn serve(
    Path(token): Path<String>,
    State(state): State<RouteServerState>,
) -> Result<Json<Value>, StatusCode> {
    if state.token.get().map(String::as_str) != Some(token.as_str()) {
        return Err(StatusCode::NOT_FOUND);
    }

    let config = state
        .config
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(config.clone()))
}

#[tauri::command]
pub async fn traefik_start_route_server(
    state: tauri::State<'_, RouteServerState>,
    port: u16,
    fallback: bool,
) -> Result<RouteServerHandle, String> {
    let inner = state.inner().clone();
    let token = inner
        .token
        .get_or_init(|| Uuid::new_v4().to_string())
        .clone();

    if inner.started.swap(true, Ordering::SeqCst) {
        return Ok(RouteServerHandle {
            token,
            port: inner.port.get().copied().unwrap_or(port),
        });
    }

    let router = Router::new()
        .route("/{token}", get(serve))
        .with_state(inner.clone());

    let bind = |port: u16| tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)));

    let listener = match bind(port).await {
        Ok(listener) => listener,
        Err(error) if !fallback => {
            inner.started.store(false, Ordering::SeqCst);
            return Err(error.to_string());
        }
        Err(_) => bind(0).await.map_err(|error| {
            inner.started.store(false, Ordering::SeqCst);
            error.to_string()
        })?,
    };

    let bound = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let _ = inner.port.set(bound);

    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    Ok(RouteServerHandle { token, port: bound })
}

#[tauri::command]
pub fn traefik_set_routes(
    state: tauri::State<'_, RouteServerState>,
    config: Value,
) -> Result<(), String> {
    let mut current = state.config.lock().map_err(|error| error.to_string())?;
    *current = config;
    Ok(())
}
