//! ThinkRail host sidecar lifecycle.
//!
//! The web UI talks to the ThinkRail host over loopback HTTP. The host runs
//! as the external sidecar binary (`binaries/thinkrail-sidecar-<triple>`)
//! built by `apps/desktop/scripts/build-sidecar.ts`, spawned here with
//! `--port 0` so the OS picks a free port. The actual port is read from the
//! `THINKRAIL_SIDECAR_READY {"port": N}` stdout line the sidecar prints (see
//! `apps/desktop/src/sidecar/desktop-sidecar-entry.ts`) and confirmed with a
//! fallback `GET /health` poll.
//!
//! The shell holds the sidecar's stdin open for its whole life. Closing it is
//! the stop request: the sidecar drains (`server.shutdown()`) and exits, and
//! the shell only kills it if that takes longer than
//! [`SIDECAR_SHUTDOWN_TIMEOUT`]. A crashed shell closes the pipe too, so the
//! host cannot outlive its window.

use std::{
    io::{BufRead, BufReader, Read},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
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
/// How long the host gets to settle sessions and credential writes after the
/// stop request before it is killed.
pub const SIDECAR_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(25);
/// Flag that makes the sidecar treat a closed stdin as the stop request.
const EXIT_ON_STDIN_CLOSE_FLAG: &str = "--exit-on-stdin-close";

/// Current Rust target triple, matching `scripts/build-sidecar.ts`.
fn current_triple() -> String {
    let os = match std::env::consts::OS {
        "windows" => "pc-windows-msvc",
        "macos" => "apple-darwin",
        _ => "unknown-linux-gnu",
    };
    format!("{}-{os}", std::env::consts::ARCH)
}

/// Directories that may hold the sidecar, most specific first. Tauri copies
/// `externalBin` next to the main executable with the target suffix removed
/// (`Contents/MacOS` on macOS, the install directory elsewhere), and
/// `tauri dev` does the same under `target/`. The crate's own `binaries/`
/// directory only exists on the machine that built the shell, so it is the
/// last resort for a plain `cargo run`.
fn sidecar_search_roots(exe_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = exe_dir {
        roots.push(dir.to_path_buf());
        roots.push(dir.join("binaries"));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    roots
}

/// Locate the sidecar binary (see [`sidecar_search_roots`]).
pub fn sidecar_binary_path() -> Option<PathBuf> {
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let names = [
        format!("thinkrail-sidecar{exe_suffix}"),
        format!("thinkrail-sidecar-{}{exe_suffix}", current_triple()),
    ];
    let exe = std::env::current_exe().ok();
    for root in sidecar_search_roots(exe.as_deref().and_then(Path::parent)) {
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
    stdin: Option<ChildStdin>,
    port: u16,
}

impl SidecarHandle {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Ask the host to stop and wait for it. Closing stdin is the request;
    /// the host then runs `server.shutdown()` (session settlement, credential
    /// writes, terminal persistence) and exits. It is only killed when it is
    /// still running after `timeout`.
    pub fn shutdown(mut self, timeout: Duration) {
        drop(self.stdin.take());
        let deadline = Instant::now() + timeout;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => thread::sleep(SHUTDOWN_POLL_INTERVAL),
                _ => break,
            }
        }
        eprintln!("[desktop] the host did not stop in time; killing it");
        // `Drop` kills and reaps the child.
    }
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(Some(_))) {
            return;
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Spawn the sidecar with a dynamic port and wait for it to report readiness.
pub fn spawn_sidecar() -> Result<SidecarHandle, String> {
    let binary = sidecar_binary_path().ok_or_else(|| {
        "thinkrail-sidecar binary not found (run `bun run build:sidecar` first)".to_string()
    })?;
    let mut command = Command::new(&binary);
    command
        .arg("--port")
        .arg("0")
        .arg(EXIT_ON_STDIN_CLOSE_FLAG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    // A release shell is a GUI process; without this Windows opens a console
    // window for the host. Debug builds keep the console so host logs show.
    #[cfg(all(windows, not(debug_assertions)))]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("could not spawn {}: {error}", binary.display()))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    // From here on the handle owns the child: every early return drops it,
    // which kills a host that never became ready.
    let mut handle = SidecarHandle {
        child,
        stdin,
        port: 0,
    };

    let stdout = stdout.ok_or_else(|| "sidecar stdout was not piped".to_string())?;
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
        match handle.child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!("sidecar exited before ready (status {status})"));
            }
            Ok(None) => {}
            Err(error) => return Err(format!("could not poll sidecar status: {error}")),
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
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
        return Err(format!("sidecar on port {port} never answered /health"));
    }
    handle.port = port;
    Ok(handle)
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

    /// Stop the host if it is running; a second call is a no-op. The handle
    /// leaves the lock before the wait so nothing else blocks behind it.
    pub fn shutdown_sidecar(&self) {
        let handle = self.0.lock().ok().and_then(|mut guard| guard.take());
        if let Some(handle) = handle {
            handle.shutdown(SIDECAR_SHUTDOWN_TIMEOUT);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_well_formed_ready_lines() {
        assert_eq!(
            parse_ready_line(r#"THINKRAIL_SIDECAR_READY {"port":4312}"#),
            Some(4312)
        );
        assert_eq!(
            parse_ready_line(r#"[log] THINKRAIL_SIDECAR_READY {"port": 80} "#),
            Some(80)
        );
        for line in [
            "",
            "listening on 4312",
            "THINKRAIL_SIDECAR_READY",
            r#"THINKRAIL_SIDECAR_READY {"port":0}"#,
            r#"THINKRAIL_SIDECAR_READY {"port":70000}"#,
            r#"THINKRAIL_SIDECAR_READY {"port":"4312"}"#,
        ] {
            assert_eq!(parse_ready_line(line), None, "{line:?}");
        }
    }

    #[test]
    fn looks_beside_the_executable_before_the_build_tree() {
        let exe_dir = Path::new("/Applications/ThinkRail.app/Contents/MacOS");
        let roots = sidecar_search_roots(Some(exe_dir));
        assert_eq!(roots.first().map(PathBuf::as_path), Some(exe_dir));
        assert_eq!(
            roots.last(),
            Some(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"))
        );
    }
}
