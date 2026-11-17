//! Shared, lazy-spawned LSP manager for the workbench and the `pi` agent.
//!
//! * [`registry`] — built-in server catalog and `lsp.json` overrides.
//! * [`detector`] — worktree-aware detection (no process is spawned).
//! * [`client`] — JSON-RPC stdio client and the per-worktree process pool.
//! * [`search`] — agent-shaped symbol search, references, definitions and
//!   outlines with a text-search fallback.
//!
//! The same operations are exposed as Tauri commands (for the web UI) and
//! through a token-protected loopback HTTP bridge whose address the shell
//! hands to the host sidecar as `THINKRAIL_LSP_BRIDGE_URL` /
//! `THINKRAIL_LSP_BRIDGE_TOKEN`, which is how the built-in `lsp-search`
//! pi extension reaches them.

pub mod client;
pub mod detector;
pub mod registry;
pub mod search;

use std::{
    collections::hash_map::RandomState,
    hash::{BuildHasher, Hasher},
    path::Path,
    sync::Arc,
    time::Duration,
};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use client::{LspError, LspPool};
use detector::{detect, DetectedLspServer};
use search::Target;

pub const BRIDGE_URL_ENV: &str = "THINKRAIL_LSP_BRIDGE_URL";
pub const BRIDGE_TOKEN_ENV: &str = "THINKRAIL_LSP_BRIDGE_TOKEN";
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Managed Tauri state.
pub struct LspState(pub Arc<LspPool>);

impl Default for LspState {
    fn default() -> Self {
        Self(Arc::new(LspPool::default()))
    }
}

/// Detection merged with the live status of started servers.
pub fn detect_with_status(pool: &LspPool, worktree: &Path) -> Vec<DetectedLspServer> {
    let statuses = pool.statuses_for(worktree);
    detect(worktree)
        .into_iter()
        .map(|mut server| {
            if server.available {
                if let Some(status) = statuses.get(&server.id) {
                    server.status = *status;
                }
            }
            server
        })
        .collect()
}

fn describe(error: LspError) -> String {
    error.to_string()
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

// --- shared operation dispatch ---------------------------------------------

/// Parameters of every operation; each uses the fields it needs.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Params {
    pub worktree_path: String,
    pub query: String,
    pub kind_filter: Option<String>,
    pub limit: Option<usize>,
    pub file_path: String,
    pub symbol_name: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub include_declaration: Option<bool>,
    pub server_id: Option<String>,
}

impl Params {
    fn target(&self) -> Target {
        Target {
            symbol_name: self.symbol_name.clone().filter(|name| !name.trim().is_empty()),
            line: self.line,
            column: self.column,
        }
    }
}

/// Run one named operation. Shared by the Tauri commands and the bridge.
pub async fn run_operation(pool: &LspPool, op: &str, params: Params) -> Result<Value, String> {
    if params.worktree_path.trim().is_empty() {
        return Err("`worktreePath` is required".into());
    }
    let worktree = Path::new(&params.worktree_path);
    if !worktree.is_dir() {
        return Err(format!("worktree `{}` does not exist", params.worktree_path));
    }
    match op {
        "detect" => to_value(detect_with_status(pool, worktree)),
        "symbol_search" => to_value(
            search::symbol_search(
                pool,
                worktree,
                &params.query,
                params.kind_filter.as_deref(),
                params.limit,
            )
            .await
            .map_err(describe)?,
        ),
        "find_references" => to_value(
            search::find_references(
                pool,
                worktree,
                &params.file_path,
                &params.target(),
                params.include_declaration.unwrap_or(false),
            )
            .await
            .map_err(describe)?,
        ),
        "goto_definition" => to_value(
            search::goto_definition(pool, worktree, &params.file_path, &params.target())
                .await
                .map_err(describe)?,
        ),
        "file_outline" => to_value(
            search::file_outline(pool, worktree, &params.file_path)
                .await
                .map_err(describe)?,
        ),
        "restart" => {
            pool.stop(worktree, params.server_id.as_deref()).await;
            to_value(detect_with_status(pool, worktree))
        }
        "release" => {
            pool.stop(worktree, None).await;
            Ok(json!({ "released": true }))
        }
        other => Err(format!("unknown operation `{other}`")),
    }
}

// --- Tauri commands --------------------------------------------------------

#[tauri::command]
pub async fn detect_workspace_lsps(
    state: State<'_, LspState>,
    worktree_path: String,
) -> Result<Value, String> {
    let params = Params { worktree_path, ..Params::default() };
    run_operation(&state.0, "detect", params).await
}

#[tauri::command]
pub async fn lsp_symbol_search(
    state: State<'_, LspState>,
    worktree_path: String,
    query: String,
    kind_filter: Option<String>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let params = Params { worktree_path, query, kind_filter, limit, ..Params::default() };
    run_operation(&state.0, "symbol_search", params).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lsp_find_references(
    state: State<'_, LspState>,
    worktree_path: String,
    file_path: String,
    symbol_name: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
    include_declaration: Option<bool>,
) -> Result<Value, String> {
    let params = Params {
        worktree_path,
        file_path,
        symbol_name,
        line,
        column,
        include_declaration,
        ..Params::default()
    };
    run_operation(&state.0, "find_references", params).await
}

#[tauri::command]
pub async fn lsp_goto_definition(
    state: State<'_, LspState>,
    worktree_path: String,
    file_path: String,
    symbol_name: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<Value, String> {
    let params = Params { worktree_path, file_path, symbol_name, line, column, ..Params::default() };
    run_operation(&state.0, "goto_definition", params).await
}

#[tauri::command]
pub async fn lsp_file_outline(
    state: State<'_, LspState>,
    worktree_path: String,
    file_path: String,
) -> Result<Value, String> {
    let params = Params { worktree_path, file_path, ..Params::default() };
    run_operation(&state.0, "file_outline", params).await
}

#[tauri::command]
pub async fn restart_workspace_lsp(
    state: State<'_, LspState>,
    worktree_path: String,
    server_id: Option<String>,
) -> Result<Value, String> {
    let params = Params { worktree_path, server_id, ..Params::default() };
    run_operation(&state.0, "restart", params).await
}

/// Create `~/.thinkrail/lsp.json` when missing and open it in the system editor.
#[tauri::command]
pub fn open_lsp_user_config(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = registry::user_override_path().ok_or("no home directory")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if !path.exists() {
        std::fs::write(&path, "{}
").map_err(|error| error.to_string())?;
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

/// Stop every language server (shell exit).
pub fn shutdown(app: &AppHandle) {
    let pool = app.state::<LspState>().0.clone();
    tauri::async_runtime::block_on(async move {
        let _ = tokio::time::timeout(Duration::from_secs(5), pool.stop_all()).await;
    });
}

// --- loopback bridge -------------------------------------------------------

/// Where the bridge listens and the bearer token it requires.
#[derive(Debug, Clone)]
pub struct BridgeInfo {
    pub url: String,
    pub token: String,
}

impl BridgeInfo {
    /// Environment entries for the host sidecar.
    pub fn env(&self) -> Vec<(String, String)> {
        vec![
            (BRIDGE_URL_ENV.to_owned(), self.url.clone()),
            (BRIDGE_TOKEN_ENV.to_owned(), self.token.clone()),
        ]
    }
}

fn random_token() -> String {
    let mut token = String::new();
    for round in 0..4u8 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u8(round);
        hasher.write_u32(std::process::id());
        hasher.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        token.push_str(&format!("{:016x}", hasher.finish()));
    }
    token
}

/// Start the idle reaper and the bridge listener. Returns once the listener
/// is bound; connections are served on the Tauri async runtime.
pub fn start_bridge(app: &AppHandle) -> Result<BridgeInfo, String> {
    let pool = app.state::<LspState>().0.clone();
    LspPool::spawn_reaper(pool.clone());
    let listener = tauri::async_runtime::block_on(TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|error| format!("could not bind the LSP bridge: {error}"))?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let info = BridgeInfo {
        url: format!("http://127.0.0.1:{port}"),
        token: random_token(),
    };
    let token = info.token.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            let (pool, token) = (pool.clone(), token.clone());
            tauri::async_runtime::spawn(async move {
                let _ = serve(stream, &pool, &token).await;
            });
        }
    });
    Ok(info)
}

#[derive(Debug, PartialEq)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub authorization: Option<String>,
    pub body: Vec<u8>,
}

/// Parse the head of an HTTP/1.1 request; returns the request line fields,
/// the auth header, and the declared body length.
pub fn parse_head(head: &str) -> Option<(String, String, Option<String>, usize)> {
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_owned();
    let path = request_line.next()?.to_owned();
    let mut authorization = None;
    let mut length = 0usize;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        match name.trim().to_ascii_lowercase().as_str() {
            "authorization" => authorization = Some(value.trim().to_owned()),
            "content-length" => length = value.trim().parse().ok()?,
            _ => {}
        }
    }
    Some((method, path, authorization, length))
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index;
        }
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err("request too large".into());
        }
        let read = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("connection closed".into());
        }
        buffer.extend_from_slice(&chunk[..read]);
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let (method, path, authorization, length) = parse_head(&head).ok_or("malformed request")?;
    if length > MAX_REQUEST_BYTES {
        return Err("request too large".into());
    }
    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("connection closed".into());
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);
    Ok(HttpRequest { method, path, authorization, body })
}

async fn respond(stream: &mut TcpStream, status: &str, body: &Value) -> std::io::Result<()> {
    let payload = body.to_string();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await
}

/// Decide the response for one request. Pure routing, no I/O.
pub async fn handle_request(pool: &LspPool, token: &str, request: HttpRequest) -> (&'static str, Value) {
    let expected = format!("Bearer {token}");
    if request.authorization.as_deref() != Some(expected.as_str()) {
        return ("401 Unauthorized", json!({ "ok": false, "error": "unauthorized" }));
    }
    let Some(op) = request.path.strip_prefix("/lsp/").filter(|_| request.method == "POST") else {
        return ("404 Not Found", json!({ "ok": false, "error": "not found" }));
    };
    let params: Params = match serde_json::from_slice(&request.body) {
        Ok(params) => params,
        Err(error) => {
            return ("400 Bad Request", json!({ "ok": false, "error": error.to_string() }));
        }
    };
    match run_operation(pool, op, params).await {
        Ok(result) => ("200 OK", json!({ "ok": true, "result": result })),
        Err(error) => ("200 OK", json!({ "ok": false, "error": error })),
    }
}

async fn serve(mut stream: TcpStream, pool: &LspPool, token: &str) -> std::io::Result<()> {
    let request = match tokio::time::timeout(READ_TIMEOUT, read_request(&mut stream)).await {
        Ok(Ok(request)) => request,
        Ok(Err(error)) => {
            return respond(&mut stream, "400 Bad Request", &json!({ "ok": false, "error": error })).await;
        }
        Err(_) => return Ok(()),
    };
    let (status, body) = handle_request(pool, token, request).await;
    respond(&mut stream, status, &body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str, auth: Option<&str>, body: &str) -> HttpRequest {
        HttpRequest {
            method: "POST".into(),
            path: path.into(),
            authorization: auth.map(str::to_owned),
            body: body.as_bytes().to_vec(),
        }
    }

    #[test]
    fn parses_request_heads() {
        let head = "POST /lsp/detect HTTP/1.1\r\nHost: x\r\nauthorization: Bearer t\r\nContent-Length: 12";
        let (method, path, auth, length) = parse_head(head).unwrap();
        assert_eq!((method.as_str(), path.as_str(), length), ("POST", "/lsp/detect", 12));
        assert_eq!(auth.as_deref(), Some("Bearer t"));
        assert!(parse_head("").is_none());
    }

    #[test]
    fn tokens_are_long_and_unique() {
        let (a, b) = (random_token(), random_token());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn bridge_rejects_missing_or_wrong_tokens() {
        let pool = LspPool::default();
        let (status, _) = handle_request(&pool, "secret", request("/lsp/detect", None, "{}")).await;
        assert_eq!(status, "401 Unauthorized");
        let (status, _) =
            handle_request(&pool, "secret", request("/lsp/detect", Some("Bearer nope"), "{}")).await;
        assert_eq!(status, "401 Unauthorized");
    }

    #[tokio::test]
    async fn bridge_routes_and_reports_errors() {
        let pool = LspPool::default();
        let auth = Some("Bearer secret");
        let (status, _) = handle_request(&pool, "secret", request("/other", auth, "{}")).await;
        assert_eq!(status, "404 Not Found");
        let (status, _) = handle_request(&pool, "secret", request("/lsp/detect", auth, "nope")).await;
        assert_eq!(status, "400 Bad Request");
        let (status, body) = handle_request(&pool, "secret", request("/lsp/detect", auth, "{}")).await;
        assert_eq!(status, "200 OK");
        assert_eq!(body["ok"], false);
        let (_, body) = handle_request(
            &pool,
            "secret",
            request("/lsp/bogus", auth, &json!({ "worktreePath": std::env::temp_dir() }).to_string()),
        )
        .await;
        assert_eq!(body["ok"], false);
    }

    #[tokio::test]
    async fn bridge_runs_detection_for_a_worktree() {
        let dir = std::env::temp_dir().join(format!("thinkrail-bridge-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("go.mod"), "").unwrap();
        let pool = LspPool::default();
        let body = json!({ "worktreePath": dir }).to_string();
        let (status, response) =
            handle_request(&pool, "t", request("/lsp/detect", Some("Bearer t"), &body)).await;
        assert_eq!(status, "200 OK");
        assert_eq!(response["ok"], true);
        assert_eq!(response["result"][0]["id"], "go");
        std::fs::remove_dir_all(dir).ok();
    }
}
