//! Application lifecycle: quit and notifications.
//!
//! Quitting ports the happy path of the Electrobun quit coordinator
//! (`updates/quitCoordinator.ts`): tell the web client, stop the host
//! gracefully, then exit. Every way out of the app (the bridge's `quit_app`,
//! the Quit menu item, closing the last window, a startup failure) ends in
//! Tauri's exit event, and [`stop_host`] runs there, so no path leaves the
//! host running or kills it mid-write.

use tauri::{AppHandle, Emitter, Manager};

use crate::sidecar::SidecarState;

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    // `quitHintChanged` keeps the Electrobun RPC message name so the web
    // `subscribeQuitHint` bridge accepts it unchanged.
    let _ = app.emit(
        "quitHintChanged",
        serde_json::json!({ "hint": "quitting" }),
    );
    app.exit(0);
}

/// Stop the host before the process ends. Runs from `RunEvent::Exit`, the one
/// point every exit path reaches; Tauri ends the process right after without
/// running destructors, so nothing else would stop the sidecar. The windows
/// are hidden first because an orderly stop can take a few seconds and a
/// frozen window would look like a hang.
pub fn stop_host(app: &AppHandle) {
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
    if let Some(state) = app.try_state::<SidecarState>() {
        state.shutdown_sidecar();
    }
}

#[tauri::command]
pub fn show_notification(
    app: AppHandle,
    title: String,
    body: String,
    subtitle: Option<String>,
    silent: Option<bool>,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    // The desktop notifier has no distinct subtitle slot; fold it above the
    // body like Electrobun's `Utils.showNotification` mapping.
    // TODO: map `silent` once the desktop builder exposes it.
    let _ = silent;
    let body = match subtitle {
        Some(subtitle) if !subtitle.trim().is_empty() => format!("{subtitle}\n{body}"),
        _ => body,
    };
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

/// Whether the shell runs as the neutral E2E host (`about:blank`, no splash).
/// Ports `process.env.THINKRAIL_DESKTOP_E2E_HOST === "1"` in
/// `apps/desktop/src/index.ts`.
pub fn is_neutral_e2e_host() -> bool {
    std::env::var("THINKRAIL_DESKTOP_E2E_HOST").as_deref() == Ok("1")
}

/// Whether the main window starts hidden.
/// Ports `process.env.THINKRAIL_DESKTOP_HIDDEN === "1"`.
pub fn is_hidden_window() -> bool {
    std::env::var("THINKRAIL_DESKTOP_HIDDEN").as_deref() == Ok("1")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// `std::env` is process-global, so env-mutating tests serialize here.
    static ENV_GUARD: Mutex<()> = Mutex::new(());

    #[test]
    fn detects_neutral_e2e_host() {
        let _guard = ENV_GUARD.lock().unwrap();
        std::env::set_var("THINKRAIL_DESKTOP_E2E_HOST", "1");
        assert!(is_neutral_e2e_host());
        std::env::set_var("THINKRAIL_DESKTOP_E2E_HOST", "0");
        assert!(!is_neutral_e2e_host());
        std::env::remove_var("THINKRAIL_DESKTOP_E2E_HOST");
        assert!(!is_neutral_e2e_host());
    }

    #[test]
    fn detects_hidden_window() {
        let _guard = ENV_GUARD.lock().unwrap();
        std::env::set_var("THINKRAIL_DESKTOP_HIDDEN", "1");
        assert!(is_hidden_window());
        std::env::set_var("THINKRAIL_DESKTOP_HIDDEN", "yes");
        assert!(!is_hidden_window());
        std::env::remove_var("THINKRAIL_DESKTOP_HIDDEN");
        assert!(!is_hidden_window());
    }
}
