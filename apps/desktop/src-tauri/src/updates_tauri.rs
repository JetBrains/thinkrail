//! Native update state (Electrobun `updateStateChanged` parity).
//!
//! The snapshot shape mirrors `NativeUpdateState` in `contracts` so the web
//! `useUpdates` guard accepts the bridge unchanged. Checking/download/install
//! are stubs: TODO wires the real flow through `tauri_plugin_updater`.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub revision: u32,
    pub status: String,
    pub version: String,
    pub channel: String,
    pub available_version: Option<String>,
    pub progress: Option<f64>,
    pub error: Option<String>,
    pub failed_phase: Option<String>,
    pub install_step: Option<String>,
    pub log: Vec<serde_json::Value>,
    pub last_install: Option<serde_json::Value>,
}

impl Default for UpdateSnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            status: "idle".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            // TODO: real release channel (stable/canary/dev) from the build.
            channel: "stable".to_string(),
            available_version: None,
            progress: None,
            error: None,
            failed_phase: None,
            install_step: None,
            log: Vec::new(),
            last_install: None,
        }
    }
}

#[derive(Default)]
pub struct UpdateState(pub Mutex<UpdateSnapshot>);

fn publish(app: &AppHandle, snapshot: &UpdateSnapshot) {
    let _ = app.emit("updateStateChanged", snapshot);
}

fn transition(
    app: &AppHandle,
    state: &tauri::State<'_, UpdateState>,
    apply: impl FnOnce(&mut UpdateSnapshot),
) -> Result<(), String> {
    let snapshot = {
        let mut guard = state.0.lock().map_err(|error| error.to_string())?;
        apply(&mut guard);
        guard.revision = guard.revision.saturating_add(1);
        guard.clone()
    };
    publish(app, &snapshot);
    Ok(())
}

#[tauri::command]
pub fn get_update_state(state: tauri::State<'_, UpdateState>) -> Result<UpdateSnapshot, String> {
    state
        .0
        .lock()
        .map(|guard| guard.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn check_for_updates(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    // TODO: run the real check via `tauri_plugin_updater::UpdaterExt` and map
    // check/download/install phases onto the snapshot (status, progress,
    // availableVersion, error/failedPhase).
    transition(&app, &state, |snapshot| {
        snapshot.status = "checking".to_string();
        snapshot.error = None;
        snapshot.failed_phase = None;
    })
}

#[tauri::command]
pub fn download_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    // TODO: download through the updater plugin with progress events.
    transition(&app, &state, |snapshot| {
        snapshot.status = "downloading".to_string();
        snapshot.progress = Some(0.0);
    })
}

#[tauri::command]
pub fn restart_to_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    // TODO: hand off to the downloaded update (install + relaunch) like the
    // Electrobun quit coordinator's `restartToUpdate`; restarting without an
    // installer staged would only lose the session.
    transition(&app, &state, |snapshot| {
        snapshot.status = "installing".to_string();
        snapshot.install_step = Some("handoff".to_string());
    })
}

#[tauri::command]
pub fn dismiss_install_result(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    transition(&app, &state, |snapshot| {
        snapshot.last_install = None;
        if snapshot.status == "error" {
            snapshot.status = "idle".to_string();
            snapshot.error = None;
            snapshot.failed_phase = None;
        }
    })
}

// ---------------------------------------------------------------------------
// tauri-plugin-updater status mapping + update-journal helpers
// ---------------------------------------------------------------------------

/// File name of the update journal under the user-data directory
/// (`UPDATE_JOURNAL_FILE` in `updates/journal.ts`).
pub const UPDATE_JOURNAL_FILE: &str = "update-journal.json";
/// Mirror of `MAX_JOURNAL_BYTES`: oversized journals read as absent.
const MAX_JOURNAL_BYTES: u64 = 256 * 1024;
/// Mirror of `MAX_UPDATE_LOG_ENTRIES`.
const MAX_JOURNAL_LOG_ENTRIES: usize = 200;
/// Mirror of `MAX_TEXT_LENGTH` for journal strings.
const MAX_JOURNAL_TEXT_LENGTH: usize = 4096;

/// Map a `tauri-plugin-updater` phase/event name onto the canonical
/// `NativeUpdateState` status vocabulary (`nativeClient.ts` in
/// `@thinkrail/contracts`: idle/checking/available/downloading/ready/error/
/// disabled). The plugin surfaces check/download progress as event names
/// (`check`, `download-progress`, `download-complete`, ...) alongside the
/// Electrobun patch-pipeline statuses the controller historically consumed;
/// post-download verification and install-handoff events report `ready` (the
/// staged bundle is complete; the restart itself is owned by the quit
/// coordinator). Unknown or empty input falls back to `idle` so the web
/// `useUpdates` guard always sees a known status.
pub fn map_tauri_update_status(status: &str) -> &'static str {
    match status {
        "disabled" => "disabled",
        "checking" | "check" => "checking",
        "available" | "update-available" => "available",
        "downloading"
        | "download-starting"
        | "download-started"
        | "download-progress"
        | "fetching-patch"
        | "downloading-patch"
        | "downloading-full-bundle" => "downloading",
        "ready"
        | "update-ready"
        | "download-complete"
        | "download-finished"
        | "preparing"
        | "applying-patch"
        | "extracting-version"
        | "patch-chain-complete"
        | "decompressing"
        | "installing"
        | "applying"
        | "launching-new-version"
        | "restarting" => "ready",
        "error" | "failed" | "install-failed" => "error",
        _ => "idle",
    }
}

/// Path of the update journal under a user-data directory.
pub fn journal_file_path(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join(UPDATE_JOURNAL_FILE)
}

fn journal_text(value: Option<&serde_json::Value>) -> Option<&str> {
    match value.and_then(|entry| entry.as_str()) {
        Some(text) if text.len() <= MAX_JOURNAL_TEXT_LENGTH => Some(text),
        _ => None,
    }
}

fn nullable_journal_text(value: Option<&serde_json::Value>) -> bool {
    match value {
        // `parseUpdateJournal` rejects missing keys (`=== undefined`).
        None => false,
        Some(serde_json::Value::Null) => true,
        Some(entry) => journal_text(Some(entry)).is_some(),
    }
}

fn journal_log_ok(value: Option<&serde_json::Value>) -> bool {
    match value.and_then(|entry| entry.as_array()) {
        Some(entries) if entries.len() <= MAX_JOURNAL_LOG_ENTRIES => {
            entries.iter().all(|entry| {
                entry.is_object()
                    && entry
                        .get("at")
                        .and_then(|at| at.as_f64())
                        .is_some_and(f64::is_finite)
                    && matches!(
                        entry.get("source").and_then(|source| source.as_str()),
                        Some("update" | "host" | "installer")
                    )
                    && matches!(
                        entry.get("level").and_then(|level| level.as_str()),
                        Some("info" | "error")
                    )
                    && entry.get("event").is_some_and(|event| event.is_object())
            })
        }
        _ => false,
    }
}

/// Best-effort shape check porting `parseUpdateJournal`: `schemaVersion: 1`
/// with a `pending` (versions + `startedAt` + log) or `resolved` (install
/// result) body. Element-level event validation stays TS-side; the shell only
/// needs to distinguish usable journals from corrupt ones.
fn valid_journal(value: &serde_json::Value) -> bool {
    if value.get("schemaVersion").and_then(|entry| entry.as_u64()) != Some(1) {
        return false;
    }
    match value.get("state").and_then(|state| state.as_str()) {
        Some("pending") => {
            journal_text(value.get("fromVersion")).is_some()
                && journal_text(value.get("toVersion")).is_some()
                && value
                    .get("startedAt")
                    .and_then(|at| at.as_f64())
                    .is_some_and(f64::is_finite)
                && journal_log_ok(value.get("log"))
        }
        Some("resolved") => match value.get("result") {
            Some(result) if result.is_object() => {
                matches!(
                    result.get("outcome").and_then(|outcome| outcome.as_str()),
                    Some("installed" | "failed" | "unreported")
                ) && journal_text(result.get("toVersion")).is_some()
                    && nullable_journal_text(result.get("fromVersion"))
                    && nullable_journal_text(result.get("failedStep"))
                    && nullable_journal_text(result.get("detail"))
                    && journal_log_ok(result.get("log"))
            }
            _ => false,
        },
        _ => false,
    }
}

/// Port of `UpdateJournalStore.read`: oversized, unreadable, or invalid
/// journals read as absent (`None`); errors are swallowed best-effort.
pub fn read_update_journal(user_data_dir: &Path) -> Option<serde_json::Value> {
    let path = journal_file_path(user_data_dir);
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_JOURNAL_BYTES {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    valid_journal(&value).then_some(value)
}

/// Port of `UpdateJournalStore.write`: compact JSON to `<path>.partial`
/// followed by a rename; a failed write removes the partial best-effort.
/// Not yet called by the commands (no behavior change there).
pub fn write_update_journal(user_data_dir: &Path, journal: &serde_json::Value) -> bool {
    let path = journal_file_path(user_data_dir);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && fs::create_dir_all(parent).is_err() {
            return false;
        }
    }
    let serialized = serde_json::to_string(journal).unwrap_or_else(|_| "{}".to_owned());
    let mut partial = path.as_os_str().to_owned();
    partial.push(".partial");
    let partial = PathBuf::from(partial);
    if fs::write(&partial, serialized).is_err() {
        let _ = fs::remove_file(&partial);
        return false;
    }
    if fs::rename(&partial, &path).is_err() {
        let _ = fs::remove_file(&partial);
        return false;
    }
    true
}

/// Port of `UpdateJournalStore.clear`: best-effort removal.
pub fn clear_update_journal(user_data_dir: &Path) {
    let _ = fs::remove_file(journal_file_path(user_data_dir));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn unique_temp_dir(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "thinkrail-updates-{}-{}-{}",
            tag,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn pending_journal() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "state": "pending",
            "fromVersion": "1.0.0",
            "toVersion": "1.0.1",
            "startedAt": 1700000000000u64,
            "log": [{ "at": 1700000000000u64, "source": "update", "level": "info",
                        "event": { "kind": "installStarted", "version": "1.0.1" } }],
        })
    }

    fn resolved_journal() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "state": "resolved",
            "result": { "outcome": "installed", "fromVersion": "1.0.0",
                          "toVersion": "1.0.1", "failedStep": null, "detail": null,
                          "log": [] },
        })
    }

    #[test]
    fn maps_plugin_states_to_native_statuses() {
        for status in ["idle", "", "up-to-date", "unknown-thing"] {
            assert_eq!(map_tauri_update_status(status), "idle", "{status:?}");
        }
        assert_eq!(map_tauri_update_status("disabled"), "disabled");
        for status in ["checking", "check"] {
            assert_eq!(map_tauri_update_status(status), "checking", "{status:?}");
        }
        for status in ["available", "update-available"] {
            assert_eq!(map_tauri_update_status(status), "available", "{status:?}");
        }
        for status in [
            "downloading",
            "download-starting",
            "download-progress",
            "fetching-patch",
            "downloading-patch",
            "downloading-full-bundle",
        ] {
            assert_eq!(
                map_tauri_update_status(status),
                "downloading",
                "{status:?}"
            );
        }
        for status in [
            "ready",
            "download-complete",
            "preparing",
            "applying-patch",
            "decompressing",
            "installing",
            "launching-new-version",
        ] {
            assert_eq!(map_tauri_update_status(status), "ready", "{status:?}");
        }
        for status in ["error", "failed"] {
            assert_eq!(map_tauri_update_status(status), "error", "{status:?}");
        }
    }

    #[test]
    fn journal_round_trip() {
        let dir = unique_temp_dir("round-trip");
        assert_eq!(read_update_journal(&dir), None);
        assert!(write_update_journal(&dir, &pending_journal()));
        assert_eq!(read_update_journal(&dir), Some(pending_journal()));
        // Resolved journals overwrite pending ones.
        assert!(write_update_journal(&dir, &resolved_journal()));
        assert_eq!(read_update_journal(&dir), Some(resolved_journal()));
        // No stray partial file left behind.
        let mut partial = journal_file_path(&dir).into_os_string();
        partial.push(".partial");
        assert!(!PathBuf::from(partial).exists());
        clear_update_journal(&dir);
        assert_eq!(read_update_journal(&dir), None);
        clear_update_journal(&dir);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn journal_rejects_invalid_documents() {
        let dir = unique_temp_dir("invalid");
        fs::create_dir_all(&dir).unwrap();
        let path = journal_file_path(&dir);
        // Corrupt JSON.
        fs::write(&path, "not json").unwrap();
        assert_eq!(read_update_journal(&dir), None);
        // Wrong schema / state / missing fields.
        for bad in [
            serde_json::json!({ "schemaVersion": 2, "state": "pending" }),
            serde_json::json!({ "schemaVersion": 1, "state": "bogus" }),
            serde_json::json!({ "schemaVersion": 1, "state": "pending" }),
            serde_json::json!({ "schemaVersion": 1, "state": "resolved",
                                 "result": { "outcome": "installed" } }),
        ] {
            fs::write(&path, serde_json::to_string(&bad).unwrap()).unwrap();
            assert_eq!(read_update_journal(&dir), None);
        }
        // Oversized journals read as absent.
        fs::write(&path, vec![b'x'; MAX_JOURNAL_BYTES as usize + 1]).unwrap();
        assert_eq!(read_update_journal(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
