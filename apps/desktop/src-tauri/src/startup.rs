//! Startup sequence, ported from `start()` in `apps/desktop/src/index.ts`.
//!
//! 1. Native menu and splash go up at once (not for the neutral E2E host).
//! 2. The host sidecar boots on a background thread, so the splash paints
//!    while it does.
//! 3. The main window is created hidden on the sidecar origin with the bridge
//!    script, the navigation policy and a capability for exactly that origin,
//!    then revealed when its page has loaded.
//!
//! Any failure is fatal: without a host there is nothing to show, so the
//! shell reports the error and exits instead of idling behind a splash.

use tauri::{AppHandle, Manager};

use crate::{bridge, lifecycle, menu, sidecar, state, window};

/// How the shell was asked to start.
#[derive(Debug, Clone, Copy)]
struct Mode {
    /// `THINKRAIL_DESKTOP_E2E_HOST=1`: host only, `about:blank`, no menu,
    /// nothing persisted.
    neutral: bool,
    /// The main window never shows itself.
    hidden: bool,
}

impl Mode {
    fn from_env() -> Self {
        let neutral = lifecycle::is_neutral_e2e_host();
        Self {
            neutral,
            hidden: neutral || lifecycle::is_hidden_window(),
        }
    }
}

/// Runs inside Tauri's `setup`: everything that must exist before the event
/// loop spins, then the boot thread.
pub fn begin(app: &AppHandle) {
    let mode = Mode::from_env();
    if !mode.neutral {
        // Captions come from the previous run until the web client pushes
        // the current language (`menu_labels_changed`).
        menu::load_saved_labels(app);
        menu::register_menu_events(app);
        // Menu first so the frame never shows an empty menubar.
        if let Err(error) = menu::build_native_menu(app) {
            eprintln!("[desktop] could not build the native menu: {error}");
        }
    }
    if !mode.hidden {
        let message = menu::native_label(app, "desktop.splash.starting");
        if let Err(error) = window::open_splash_window(app, &message) {
            eprintln!("[desktop] could not open the splash window: {error}");
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(detail) = boot(&app, mode) {
            fail(&app, &detail);
        }
    });
}

/// Start the host and open the main window on it.
fn boot(app: &AppHandle, mode: Mode) -> Result<(), String> {
    let host = sidecar::spawn_sidecar()
        .map_err(|error| format!("could not start the host sidecar: {error}"))?;
    let origin = format!("http://127.0.0.1:{}", host.port());
    eprintln!("[desktop] sidecar ready on port {}", host.port());
    // Stored before anything else can fail, so the exit path can stop it.
    app.state::<sidecar::SidecarState>().set(host);

    if mode.neutral {
        open_neutral_window(app)?;
        write_ready_file(&origin);
    } else {
        open_ui_window(app, &origin)?;
    }
    Ok(())
}

/// The neutral E2E host serves no UI: a hidden `about:blank` window with no
/// bridge (mirrors `url: "about:blank"` + `hidden` in `index.ts`).
fn open_neutral_window(app: &AppHandle) -> Result<(), String> {
    let blank = url::Url::parse("about:blank")
        .map_err(|error| format!("could not build the main window URL: {error}"))?;
    window::open_main_window(app, blank, None).map(|_| ())
}

/// The UI window: `${origin}/${initialRoute}` with the bridge installed.
fn open_ui_window(app: &AppHandle, origin: &str) -> Result<(), String> {
    let destination = format!("{origin}/{}", state::initial_route(app));
    let url = url::Url::parse(&destination)
        .map_err(|error| format!("could not build the sidecar URL: {error}"))?;
    bridge::allow_bridge_from(app, origin)
        .map_err(|error| format!("could not grant the bridge to the sidecar origin: {error}"))?;
    let script =
        bridge::initialization_script(&window::window_chrome_seed(), &state::initial_preferences(app));
    let main = window::open_main_window(app, url, Some((script, origin.to_owned())))?;
    // Per-OS window policy (decorations, overlay traffic lights).
    window::configure_main_window(&main);
    Ok(())
}

/// Readiness file for the E2E harness (mirrors the `dom-ready`
/// `writeReady(THINKRAIL_DESKTOP_READY_FILE, ...)` in `index.ts`).
fn write_ready_file(origin: &str) {
    let Some(path) = std::env::var_os("THINKRAIL_DESKTOP_READY_FILE").filter(|path| !path.is_empty())
    else {
        return;
    };
    let path = std::path::PathBuf::from(path);
    let payload = serde_json::json!({
        "origin": origin,
        "windowUrl": "about:blank",
        "mode": "host",
        "pid": std::process::id(),
    });
    let written = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(&path, payload.to_string()));
    if let Err(error) = written {
        eprintln!("[desktop] could not write the ready file: {error}");
    }
}

/// Fatal startup error, mirroring the `index.ts` catch path: show the
/// `startFailed` dialog, then exit non-zero. The exit event stops the host
/// if it got as far as running. Must not run on the main thread: the dialog
/// blocks until it is dismissed.
fn fail(app: &AppHandle, detail: &str) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    eprintln!("[desktop] startup failed: {detail}");
    window::hide_splash(app);
    let title = menu::native_label(app, "desktop.dialog.startFailed");
    app.dialog()
        .message(format!("{title}\n\n{detail}"))
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCustom(menu::native_label(
            app,
            "desktop.dialog.quit",
        )))
        .blocking_show();
    app.exit(1);
}
