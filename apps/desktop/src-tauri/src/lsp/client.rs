//! Multiplexed JSON-RPC 2.0 stdio client and the per-worktree process pool.
//!
//! One [`LspClient`] owns one language-server child. A writer task serializes
//! outgoing frames, a reader task routes responses to pending requests by id
//! and answers the few server-initiated requests servers block on. The
//! [`LspPool`] keys clients by `(canonical worktree, server id)` so parallel
//! git worktrees never share a server, spawns lazily on first use, and reaps
//! idle clients.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicI64, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use thiserror::Error;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, oneshot, Mutex},
};

use super::detector::{launch_plan, LaunchPlan, LspStatus};
use super::registry::language_id;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
pub const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(45);
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const REAP_INTERVAL: Duration = Duration::from_secs(30);
/// Largest framed message accepted from a server.
const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;
/// Documents kept open per server before the oldest are closed.
const MAX_OPEN_DOCUMENTS: usize = 256;

#[derive(Debug, Error)]
pub enum LspError {
    #[error("language server `{0}` is not available for this worktree")]
    Unavailable(String),
    #[error("could not start language server: {0}")]
    Spawn(String),
    #[error("language server request `{0}` timed out")]
    Timeout(String),
    #[error("language server error: {0}")]
    Server(String),
    #[error("language server connection closed")]
    Closed,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Invalid(String),
}

// --- framing ---------------------------------------------------------------

/// Encode one message with its `Content-Length` header.
pub fn encode_message(message: &Value) -> Vec<u8> {
    let body = message.to_string();
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend_from_slice(body.as_bytes());
    frame
}

/// Read one framed message. `Ok(None)` is a clean end of stream.
pub async fn read_message<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Value>, LspError> {
    let mut length: Option<usize> = None;
    let mut seen_header = false;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await? == 0 {
            return Ok(None);
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            if seen_header {
                break;
            }
            continue;
        }
        seen_header = true;
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().ok();
            }
        }
    }
    let length = length.ok_or_else(|| LspError::Invalid("missing Content-Length".into()))?;
    if length > MAX_MESSAGE_BYTES {
        return Err(LspError::Invalid(format!("message of {length} bytes exceeds the limit")));
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).await?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| LspError::Invalid(error.to_string()))
}

// --- uris ------------------------------------------------------------------

/// Strip the Windows verbatim prefix `canonicalize` adds.
pub fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => match rest.strip_prefix(r"UNC\") {
            Some(share) => PathBuf::from(format!(r"\\{share}")),
            None => PathBuf::from(rest),
        },
        None => path,
    }
}

pub fn path_to_uri(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    // `//server/share/x` is a UNC path: `file://server/share/x`.
    let mut uri = String::from(if text.starts_with("//") { "file:" } else { "file://" });
    if !text.starts_with('/') {
        uri.push('/');
    }
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => {
                uri.push(byte as char)
            }
            other => uri.push_str(&format!("%{other:02X}")),
        }
    }
    uri
}

pub fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let mut bytes = Vec::with_capacity(rest.len());
    let raw = rest.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' && index + 2 < raw.len() {
            if let Ok(value) = u8::from_str_radix(&rest[index + 1..index + 3], 16) {
                bytes.push(value);
                index += 3;
                continue;
            }
        }
        bytes.push(raw[index]);
        index += 1;
    }
    let text = String::from_utf8(bytes).ok()?;
    // `/C:/x` -> `C:/x` on Windows drive paths.
    let trimmed = match text.as_bytes() {
        [b'/', drive, b':', ..] if drive.is_ascii_alphabetic() => &text[1..],
        _ => &text[..],
    };
    Some(PathBuf::from(trimmed))
}

// --- client ----------------------------------------------------------------

type Pending = Arc<StdMutex<HashMap<i64, oneshot::Sender<Result<Value, LspError>>>>>;

struct OpenDoc {
    version: i32,
    text: String,
}

pub struct LspClient {
    next_id: AtomicI64,
    outgoing: mpsc::UnboundedSender<Vec<u8>>,
    pending: Pending,
    alive: Arc<AtomicBool>,
    opened: Mutex<HashMap<PathBuf, OpenDoc>>,
    last_used: StdMutex<Instant>,
    child: Mutex<Option<Child>>,
}

impl LspClient {
    /// Spawn the server and complete the `initialize` handshake.
    pub async fn start(root: &Path, plan: &LaunchPlan) -> Result<Arc<Self>, LspError> {
        let mut command = Command::new(&plan.binary);
        command
            .args(&plan.args)
            .envs(&plan.env)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|error| LspError::Spawn(format!("{}: {error}", plan.binary.display())))?;
        let mut stdin = child.stdin.take().ok_or(LspError::Closed)?;
        let stdout = child.stdout.take().ok_or(LspError::Closed)?;

        let (outgoing, mut queue) = mpsc::unbounded_channel::<Vec<u8>>();
        let pending: Pending = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));

        tokio::spawn(async move {
            while let Some(frame) = queue.recv().await {
                if stdin.write_all(&frame).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
        });

        {
            let pending = pending.clone();
            let alive = alive.clone();
            let reply = outgoing.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                while let Ok(Some(message)) = read_message(&mut reader).await {
                    route_incoming(message, &pending, &reply);
                }
                alive.store(false, Ordering::SeqCst);
                let waiting: Vec<_> = pending.lock().unwrap().drain().collect();
                for (_, sender) in waiting {
                    let _ = sender.send(Err(LspError::Closed));
                }
            });
        }

        let client = Arc::new(Self {
            next_id: AtomicI64::new(1),
            outgoing,
            pending,
            alive,
            opened: Mutex::default(),
            last_used: StdMutex::new(Instant::now()),
            child: Mutex::new(Some(child)),
        });
        let root_uri = path_to_uri(root);
        let name = root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "workspace".into());
        client
            .request_with(
                "initialize",
                json!({
                    "processId": std::process::id(),
                    "clientInfo": { "name": "thinkrail" },
                    "rootUri": root_uri,
                    "workspaceFolders": [{ "uri": root_uri, "name": name }],
                    "initializationOptions": plan.initialization_options,
                    "capabilities": {
                        "workspace": { "symbol": {}, "workspaceFolders": true },
                        "textDocument": {
                            "synchronization": {},
                            "documentSymbol": { "hierarchicalDocumentSymbolSupport": true },
                            "definition": { "linkSupport": true },
                            "references": {}
                        },
                        "general": { "positionEncodings": ["utf-16"] }
                    }
                }),
                INITIALIZE_TIMEOUT,
            )
            .await?;
        client.notify("initialized", json!({}))?;
        Ok(client)
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn idle_for(&self) -> Duration {
        self.last_used.lock().unwrap().elapsed()
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), LspError> {
        let frame = encode_message(&json!({ "jsonrpc": "2.0", "method": method, "params": params }));
        self.outgoing.send(frame).map_err(|_| LspError::Closed)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, LspError> {
        self.request_with(method, params, REQUEST_TIMEOUT).await
    }

    pub async fn request_with(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, LspError> {
        *self.last_used.lock().unwrap() = Instant::now();
        if !self.is_alive() {
            return Err(LspError::Closed);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, sender);
        let frame = encode_message(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        );
        if self.outgoing.send(frame).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err(LspError::Closed);
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(LspError::Closed),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                let _ = self.notify("$/cancelRequest", json!({ "id": id }));
                Err(LspError::Timeout(method.to_owned()))
            }
        }
    }

    /// Make the server's view of `path` match the disk: `didOpen` the first
    /// time, `didChange` (full text) when the content changed since.
    pub async fn sync_file(&self, path: &Path) -> Result<String, LspError> {
        // Hold the document lock across the read so snapshots publish in read order.
        *self.last_used.lock().unwrap() = Instant::now();
        let mut opened = self.opened.lock().await;
        if opened.len() >= MAX_OPEN_DOCUMENTS && !opened.contains_key(path) {
            for (old, _) in opened.drain() {
                let _ = self.notify(
                    "textDocument/didClose",
                    json!({ "textDocument": { "uri": path_to_uri(&old) } }),
                );
            }
        }
        let text = tokio::fs::read_to_string(path).await?;
        let uri = path_to_uri(path);
        match opened.get_mut(path) {
            None => {
                let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                self.notify(
                    "textDocument/didOpen",
                    json!({ "textDocument": {
                        "uri": uri, "languageId": language_id(extension),
                        "version": 1, "text": text,
                    }}),
                )?;
                opened.insert(path.to_path_buf(), OpenDoc { version: 1, text: text.clone() });
            }
            Some(doc) if doc.text != text => {
                doc.version += 1;
                self.notify(
                    "textDocument/didChange",
                    json!({
                        "textDocument": { "uri": uri, "version": doc.version },
                        "contentChanges": [{ "text": text }]
                    }),
                )?;
                doc.text = text.clone();
            }
            Some(_) => {}
        }
        Ok(text)
    }

    /// Kill the child without waiting (best effort).
    pub fn kill_now(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.try_lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.start_kill();
            }
        }
    }

    pub async fn shutdown(&self) {
        if self.is_alive() {
            let _ = self.request_with("shutdown", Value::Null, Duration::from_secs(3)).await;
            let _ = self.notify("exit", Value::Null);
        }
        self.alive.store(false, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            let _ = child.start_kill();
        }
    }
}

/// Route one server message: resolve a pending request or answer a request
/// the server made of us.
fn route_incoming(message: Value, pending: &Pending, reply: &mpsc::UnboundedSender<Vec<u8>>) {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str);
    match (id, method) {
        (Some(id), None) => {
            let Some(key) = id.as_i64() else { return };
            let Some(sender) = pending.lock().unwrap().remove(&key) else {
                return;
            };
            let outcome = match message.get("error") {
                Some(error) => Err(LspError::Server(
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown error")
                        .to_owned(),
                )),
                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            };
            let _ = sender.send(outcome);
        }
        (Some(id), Some(method)) => {
            let result = match method {
                "workspace/configuration" => {
                    let count = message
                        .pointer("/params/items")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len);
                    Value::Array(vec![Value::Null; count])
                }
                _ => Value::Null,
            };
            let _ = reply.send(encode_message(
                &json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            ));
        }
        _ => {}
    }
}

// --- pool ------------------------------------------------------------------

type Key = (PathBuf, String);
type Slot = Arc<Mutex<Option<Arc<LspClient>>>>;

#[derive(Default)]
pub struct LspPool {
    slots: StdMutex<HashMap<Key, Slot>>,
    statuses: StdMutex<HashMap<Key, LspStatus>>,
}

pub fn canonical(worktree: &Path) -> PathBuf {
    strip_verbatim(std::fs::canonicalize(worktree).unwrap_or_else(|_| worktree.to_path_buf()))
}

impl LspPool {
    fn slot(&self, key: &Key) -> Slot {
        self.slots.lock().unwrap().entry(key.clone()).or_default().clone()
    }

    fn set_status(&self, key: &Key, status: LspStatus) {
        self.statuses.lock().unwrap().insert(key.clone(), status);
    }

    /// Statuses of started (or failed) servers for a worktree, by server id.
    pub fn statuses_for(&self, worktree: &Path) -> HashMap<String, LspStatus> {
        let root = canonical(worktree);
        self.statuses
            .lock()
            .unwrap()
            .iter()
            .filter(|((path, _), _)| *path == root)
            .map(|((_, id), status)| (id.clone(), *status))
            .collect()
    }

    /// The warm client for `(worktree, id)`, spawning it on first use.
    /// Concurrent callers share one spawn.
    pub async fn client(&self, worktree: &Path, id: &str) -> Result<Arc<LspClient>, LspError> {
        let root = canonical(worktree);
        let key = (root.clone(), id.to_owned());
        let slot = self.slot(&key);
        let mut guard = slot.lock().await;
        if let Some(client) = guard.as_ref() {
            if client.is_alive() {
                return Ok(client.clone());
            }
            self.set_status(&key, LspStatus::Error);
        }
        let plan = launch_plan(&root, id).ok_or_else(|| LspError::Unavailable(id.to_owned()))?;
        self.set_status(&key, LspStatus::Starting);
        match LspClient::start(&root, &plan).await {
            Ok(client) => {
                self.set_status(&key, LspStatus::Ready);
                *guard = Some(client.clone());
                Ok(client)
            }
            Err(error) => {
                self.set_status(&key, LspStatus::Error);
                *guard = None;
                Err(error)
            }
        }
    }

    /// Stop one server (or all of a worktree's when `id` is `None`).
    pub async fn stop(&self, worktree: &Path, id: Option<&str>) {
        let root = canonical(worktree);
        let victims: Vec<(Key, Slot)> = self
            .slots
            .lock()
            .unwrap()
            .iter()
            .filter(|((path, sid), _)| *path == root && id.is_none_or(|wanted| wanted == sid))
            .map(|(key, slot)| (key.clone(), slot.clone()))
            .collect();
        for (key, slot) in victims {
            if let Some(client) = slot.lock().await.take() {
                client.shutdown().await;
            }
            self.statuses.lock().unwrap().remove(&key);
        }
    }

    /// Shut down clients that have been idle longer than `max_idle`.
    pub async fn reap_idle(&self, max_idle: Duration) {
        let slots: Vec<(Key, Slot)> = self
            .slots
            .lock()
            .unwrap()
            .iter()
            .map(|(key, slot)| (key.clone(), slot.clone()))
            .collect();
        for (key, slot) in slots {
            let Ok(mut guard) = slot.try_lock() else { continue };
            let expired = guard
                .as_ref()
                .is_some_and(|client| !client.is_alive() || client.idle_for() > max_idle);
            if expired {
                if let Some(client) = guard.take() {
                    client.shutdown().await;
                }
                self.statuses.lock().unwrap().remove(&key);
            }
        }
    }

    /// Stop every client concurrently; whatever has not exited by `deadline` is killed.
    pub async fn stop_all_within(&self, deadline: Duration) {
        let slots: Vec<Slot> = self.slots.lock().unwrap().values().cloned().collect();
        let mut clients = Vec::new();
        for slot in slots {
            if let Some(client) = slot.lock().await.take() {
                clients.push(client);
            }
        }
        let tasks: Vec<_> = clients
            .iter()
            .cloned()
            .map(|client| tokio::spawn(async move { client.shutdown().await }))
            .collect();
        let _ = tokio::time::timeout(deadline, async {
            for task in tasks {
                let _ = task.await;
            }
        })
        .await;
        for client in &clients {
            client.kill_now();
        }
        self.statuses.lock().unwrap().clear();
    }

    pub async fn stop_all(&self) {
        self.stop_all_within(Duration::from_secs(4)).await;
    }

    /// Background idle reaper; runs until the process exits.
    pub fn spawn_reaper(pool: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(REAP_INTERVAL).await;
                pool.reap_idle(IDLE_TIMEOUT).await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_has_exact_content_length() {
        let frame = encode_message(&json!({ "a": "é" }));
        let text = String::from_utf8(frame).unwrap();
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        assert_eq!(head, format!("Content-Length: {}", body.len()));
        assert_eq!(body.len(), r#"{"a":"é"}"#.len());
    }

    #[tokio::test]
    async fn reads_back_to_back_frames_and_eof() {
        let mut bytes = encode_message(&json!({ "id": 1 }));
        bytes.extend(encode_message(&json!({ "id": 2, "result": [1, 2] })));
        let mut reader = BufReader::new(&bytes[..]);
        assert_eq!(read_message(&mut reader).await.unwrap(), Some(json!({ "id": 1 })));
        assert_eq!(
            read_message(&mut reader).await.unwrap(),
            Some(json!({ "id": 2, "result": [1, 2] }))
        );
        assert_eq!(read_message(&mut reader).await.unwrap(), None);
    }

    #[tokio::test]
    async fn tolerates_extra_headers_and_case() {
        let body = r#"{"ok":true}"#;
        let raw = format!(
            "content-type: application/vscode-jsonrpc; charset=utf-8\r\nCONTENT-LENGTH: {}\r\n\r\n{body}",
            body.len()
        );
        let mut reader = BufReader::new(raw.as_bytes());
        assert_eq!(read_message(&mut reader).await.unwrap(), Some(json!({ "ok": true })));
    }

    #[tokio::test]
    async fn missing_length_is_an_error() {
        let mut reader = BufReader::new(&b"X-Other: 1\r\n\r\n{}"[..]);
        assert!(read_message(&mut reader).await.is_err());
    }

    #[test]
    fn responses_resolve_pending_and_server_requests_are_answered() {
        let pending: Pending = Arc::default();
        let (sender, mut receiver) = oneshot::channel();
        pending.lock().unwrap().insert(7, sender);
        let (reply, mut replies) = mpsc::unbounded_channel();
        route_incoming(json!({ "id": 7, "result": { "x": 1 } }), &pending, &reply);
        assert_eq!(receiver.try_recv().unwrap().unwrap(), json!({ "x": 1 }));

        route_incoming(
            json!({ "id": 3, "method": "workspace/configuration", "params": { "items": [{}, {}] } }),
            &pending,
            &reply,
        );
        let frame = String::from_utf8(replies.try_recv().unwrap()).unwrap();
        assert!(frame.ends_with(r#""result":[null,null]}"#) || frame.contains("[null,null]"));
    }

    #[test]
    fn error_responses_surface_the_message() {
        let pending: Pending = Arc::default();
        let (sender, mut receiver) = oneshot::channel();
        pending.lock().unwrap().insert(1, sender);
        let (reply, _replies) = mpsc::unbounded_channel();
        route_incoming(json!({ "id": 1, "error": { "code": -1, "message": "boom" } }), &pending, &reply);
        let error = receiver.try_recv().unwrap().unwrap_err();
        assert_eq!(error.to_string(), "language server error: boom");
    }

    #[test]
    fn uri_round_trip() {
        let unix = Path::new("/home/me/my project/a#b.rs");
        let uri = path_to_uri(unix);
        assert_eq!(uri, "file:///home/me/my%20project/a%23b.rs");
        assert_eq!(uri_to_path(&uri).unwrap(), unix);
        let win = Path::new("C:\\work\\x.rs");
        let uri = path_to_uri(win);
        assert_eq!(uri, "file:///C:/work/x.rs");
        assert_eq!(uri_to_path(&uri).unwrap(), PathBuf::from("C:/work/x.rs"));
    }

    #[test]
    fn verbatim_prefix_is_stripped() {
        assert_eq!(strip_verbatim(PathBuf::from(r"\\?\C:\a")), PathBuf::from(r"C:\a"));
        assert_eq!(strip_verbatim(PathBuf::from("/a")), PathBuf::from("/a"));
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\UNC\srv\share\x")),
            PathBuf::from(r"\\srv\share\x")
        );
        assert_eq!(path_to_uri(Path::new(r"\\srv\share\a b")), "file://srv/share/a%20b");
    }

    #[tokio::test]
    async fn pool_reports_unavailable_without_a_marker() {
        let dir = std::env::temp_dir().join(format!("thinkrail-pool-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pool = LspPool::default();
        assert!(matches!(
            pool.client(&dir, "rust").await,
            Err(LspError::Unavailable(_))
        ));
        std::fs::remove_dir_all(dir).ok();
    }
}
