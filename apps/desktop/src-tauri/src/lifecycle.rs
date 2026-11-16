//! Application lifecycle: quit and notifications.
//!
//! TODO: port the Electrobun quit coordinator (`quitCoordinator` in
//! `updates/quitCoordinator.ts`: confirm unsaved work, stop the host
//! gracefully, then exit) instead of exiting immediately.

use tauri::{AppHandle, Emitter, Manager};

use crate::sidecar::SidecarState;

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        state.shutdown_sidecar();
    }
    app.exit(0);
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

/// Request an orderly shutdown: release the web quit hint, stop the host
/// sidecar, then exit. Ports the Electrobun quit coordinator's happy path
/// (`quitCoordinator.quit()` in `updates/quitCoordinator.ts`: wait for the
/// host to stop, then quit); the unsaved-work confirmation stays web-side
/// behind the `quitHint` handshake.
///
/// Suggested `on_window_event` wiring in `main.rs` (kept as a comment: the
/// shell bootstrap owns that file, so full wiring there would be riskier):
/// ```ignore
/// tauri::WindowEvent::CloseRequested { api, .. } => {
///     // Electrobun `before-quit` parity: only an approved close proceeds to
///     // shutdown; anything else is deferred to the web `quitHint` handshake.
///     if approved {
///         api.prevent_close();
///         lifecycle::request_graceful_shutdown(window.app_handle());
///     }
/// }
/// ```
pub fn request_graceful_shutdown(app: &AppHandle) {
    // `quitHintChanged` keeps the Electrobun RPC message name so the web
    // `subscribeQuitHint` bridge accepts it unchanged.
    let _ = app.emit(
        "quitHintChanged",
        serde_json::json!({ "hint": "quitting" }),
    );
    if let Some(state) = app.try_state::<SidecarState>() {
        state.shutdown_sidecar();
    }
    app.exit(0);
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
