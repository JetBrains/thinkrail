//! ThinkRail host sidecar lifecycle.
//!
//! The web UI talks to the ThinkRail host over loopback HTTP. The host runs
//! as the external sidecar binary (`binaries/thinkrail-sidecar-<triple>`)
//! built by `apps/desktop/scripts/build-sidecar.ts`, spawned here with
//! `--port 0` so the OS picks a free port. The actual port is read from the
//! `THINKRAIL_SIDECAR_READY {"port": N}` stdout line the sidecar prints (see
//! `apps/desktop/src/sidecar/desktop-sidecar-entry.ts`), confirmed with a
//! fallback `GET /health` poll, and exposed to the frontend through the
//! `get_sidecar_port` command.

use std::{
    io::{BufRead, BufReader, Read},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};

/// Marker printed by the sidecar once `bootHost()` is listening.
pub const SIDECAR_READY_MARKER: &str = "THINKRAIL_SIDECAR_READY";
/// Upper bound for the whole spawn-to-ready handshake.
pub const SIDECAR_READY_TIMEOUT: Duration = Duration::from_secs(30);
/// Upper bound for the `/health` confirmation after the ready line.
pub const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(15);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// Current Rust target triple, matching `scripts/build-sidecar.ts`.
fn current_triple() -> String {
    let os = match std::env::consts::OS {
        "windows" => "pc-windows-msvc",
        "macos" => "apple-darwin",
        _ => "unknown-linux-gnu",
    };
    format!("{}-{os}", std::env::consts::ARCH)
}

/// Locate the sidecar binary: Tauri bundles `externalBin` output under a
/// `binaries/` directory next to the resources, while `cargo`/Bun dev runs
/// resolve it from the crate directory.
pub fn sidecar_binary_path() -> Option<PathBuf> {
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let names = [
        format!("thinkrail-sidecar-{}{exe_suffix}", current_triple()),
        format!("thinkrail-sidecar{exe_suffix}"),
    ];
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("binaries"));
            roots.push(dir.join("../Resources/binaries"));
            roots.push(dir.join("../resources/binaries"));
        }
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    for root in roots {
        for name in &names {
            let candidate = root.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Parse `THINKRAIL_SIDECAR_READY {"port": N}`; anything else is ignored so
/// Bun warnings or extension logs on stdout cannot confuse the handshake.
fn parse_ready_line(line: &str) -> Option<u16> {
    let (_, payload) = line.split_once(SIDECAR_READY_MARKER)?;
    let value: serde_json::Value = serde_json::from_str(payload.trim()).ok()?;
    let port: u16 = value.get("port")?.as_u64()?.try_into().ok()?;
    if port == 0 {
        return None;
    }
    Some(port)
}

/// Handle to the running host. Dropping without [`SidecarHandle::shutdown`]
/// still kills the child so the host can never be orphaned.
pub struct SidecarHandle {
    child: Child,
    port: u16,
}

impl SidecarHandle {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Best-effort shutdown. The sidecar already exits on SIGINT/SIGTERM;
    /// TODO: ask it to drain over HTTP first so in-flight agent turns can
    /// checkpoint (mirrors the Electrobun quit coordinator's host shutdown).
    pub fn shutdown(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// Spawn the sidecar with a dynamic port and wait for it to report readiness.
pub fn spawn_sidecar() -> Result<SidecarHandle, String> {
    let binary = sidecar_binary_path().ok_or_else(|| {
        "thinkrail-sidecar binary not found (run `bun run build:sidecar` first)".to_string()
    })?;
    let mut child = Command::new(&binary)
        .arg("--port")
        .arg("0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("could not spawn {}: {error}", binary.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout was not piped".to_string())?;
    let (lines_tx, lines_rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if lines_tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let deadline = Instant::now() + SIDECAR_READY_TIMEOUT;
    let port = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!("sidecar exited before ready (status {status})"));
            }
            Ok(None) => {}
            Err(error) => return Err(format!("could not poll sidecar status: {error}")),
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let _ = child.kill();
            return Err(format!(
                "timed out after {}s waiting for {SIDECAR_READY_MARKER}",
                SIDECAR_READY_TIMEOUT.as_secs()
            ));
        }
        match lines_rx.recv_timeout(remaining.min(Duration::from_secs(1))) {
            Ok(line) => {
                if let Some(port) = parse_ready_line(&line) {
                    break port;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("sidecar closed stdout before reporting ready".to_string());
            }
        }
    };

    // Fallback confirmation: the ready line is authoritative, but a /health
    // poll guards against half-open hosts before the UI connects.
    if !wait_for_health(port, HEALTH_POLL_TIMEOUT) {
        let _ = child.kill();
        return Err(format!("sidecar on port {port} never answered /health"));
    }
    Ok(SidecarHandle { child, port })
}

/// Poll `GET /health` until it answers `200` + `ok` or the timeout elapses.
pub fn wait_for_health(port: u16, timeout: Duration) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if health_once(addr) {
            return true;
        }
        thread::sleep(HEALTH_POLL_INTERVAL);
    }
    health_once(addr)
}

fn health_once(addr: SocketAddr) -> bool {
    let stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut stream = stream;
    if std::io::Write::write_all(
        &mut stream,
        b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .is_err()
    {
        return false;
    }
    let mut raw = Vec::new();
    if stream.read_to_end(&mut raw).is_err() {
        return false;
    }
    let text = String::from_utf8_lossy(&raw);
    let mut parts = text.splitn(2, "\r\n\r\n");
    let head = parts.next().unwrap_or("");
    let body = parts.next().unwrap_or("");
    head.contains(" 200") && body.trim() == "ok"
}

/// Managed state holding the running host (if startup succeeded).
#[derive(Default)]
pub struct SidecarState(pub Mutex<Option<SidecarHandle>>);

impl SidecarState {
    pub fn set(&self, handle: SidecarHandle) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(handle);
        }
    }

    pub fn port(&self) -> Option<u16> {
        self.0.lock().ok()?.as_ref().map(SidecarHandle::port)
    }

    pub fn shutdown_sidecar(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(handle) = guard.take() {
                handle.shutdown();
            }
        }
    }
}

/// Frontend query for the loopback port the sidecar reported as ready.
#[tauri::command]
pub fn get_sidecar_port(state: tauri::State<'_, SidecarState>) -> Option<u16> {
    state.port()
}
