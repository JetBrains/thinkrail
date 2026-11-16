//! ThinkRail desktop shell (Tauri v2 migration).
//!
//! The web UI (`apps/web`) is served from `frontendDist` (or the dev server
//! in `tauri dev`) while the ThinkRail host runs as an external sidecar
//! binary (`binaries/thinkrail-sidecar-<triple>`), spawned at startup through
//! [`sidecar`]. Native menus come from `tauri::menu` in the core crate.
//!
//! The frontend bridge (`apps/desktop/src/bridge/`) installs the same frozen
//! globals the Electrobun preload did; commands and events below keep the
//! Electrobun RPC message names (`get_window_state`, `updateStateChanged`,
//! …) so the web shape-guards accept the Tauri shell unchanged.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lifecycle;
mod menu;
mod navigation;
mod sidecar;
mod state;
mod updates_tauri;
mod window;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // The single-instance plugin is registered first so that URLs opened
        // in a second instance are forwarded to the running app.
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(state::PreferenceStore::default())
        .manage(menu::MenuLabels::default())
        .manage(updates_tauri::UpdateState::default())
        .manage(sidecar::SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            window::get_window_state,
            window::minimize_window,
            window::toggle_maximize_window,
            window::close_window,
            window::title_bar_double_click,
            window::page_zoom_requested,
            window::page_zoom_gesture_requested,
            lifecycle::quit_app,
            lifecycle::show_notification,
            navigation::route_changed,
            navigation::deep_link_ready,
            state::preference_write,
            state::preference_remove,
            menu::menu_labels_changed,
            updates_tauri::get_update_state,
            updates_tauri::check_for_updates,
            updates_tauri::download_update,
            updates_tauri::restart_to_update,
            updates_tauri::dismiss_install_result,
            sidecar::get_sidecar_port,
        ])
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            // Register the statically configured thinkrail:// schemes at
            // runtime so deep links also resolve on Linux/Windows dev builds
            // and installs that skipped scheme registration.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            // Forward thinkrail:// links (first launch and single-instance
            // second launches, which the single-instance plugin routes here
            // via its `deep-link` feature) as `openFile` events. Links that
            // arrive before the web UI reports its first route are buffered
            // until `route_changed`/`deep_link_ready` drains them.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if let Err(error) =
                            navigation::forward_deep_link(&handle, url.as_str())
                        {
                            eprintln!("[desktop] ignoring invalid deep link: {error}");
                        }
                    }
                });
            }
            // Startup parity with `apps/desktop/src/index.ts` (`start()`):
            // neutral E2E hosts serve `about:blank` with no menu, and hidden
            // windows stay hidden until the web UI shows itself.
            let neutral = lifecycle::is_neutral_e2e_host();
            let hidden = lifecycle::is_hidden_window() || neutral;
            // Fatal startup errors mirror the `index.ts` catch path: show the
            // startFailed dialog, then exit non-zero instead of idling.
            let fail_startup = |handle: &tauri::AppHandle, detail: &str| {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                handle
                    .dialog()
                    .message(detail.to_owned())
                    .title("ThinkRail could not start")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
                std::process::exit(1);
            };
            // Native menu first so the frame never shows an empty menubar.
            // The neutral E2E host serves no UI, so it installs no menu.
            // TODO: surface failures through the startup error dialog.
            if !neutral {
                if let Err(error) = menu::build_native_menu(app.handle()) {
                    eprintln!("[desktop] could not build the native menu: {error}");
                }
            }
            // Per-OS window policy (decorations, overlay traffic lights).
            if let Some(main) = app.get_webview_window("main") {
                window::configure_main_window(&main);
            }
            // Host sidecar. A missing binary (plain `tauri dev` without
            // `bun run build:sidecar`) is non-fatal so the UI still opens.
            // TODO: show the startFailed dialog and quit like Electrobun.
            let mut origin: Option<String> = None;
            match sidecar::spawn_sidecar() {
                Ok(handle) => {
                    eprintln!("[desktop] sidecar ready on port {}", handle.port());
                    origin = Some(format!("http://127.0.0.1:{}", handle.port()));
                    if let Some(state) = app.try_state::<sidecar::SidecarState>() {
                        state.set(handle);
                    }
                }
                Err(error) => {
                    eprintln!("[desktop] could not start the host sidecar: {error}");
                    // A neutral host without a sidecar serves nothing, so fail
                    // like the `index.ts` catch path instead of idling blank.
                    if neutral {
                        fail_startup(
                            app.handle(),
                            &format!("could not start the host sidecar: {error}"),
                        );
                        return Err("could not start the host sidecar".into());
                    }
                }
            }
            if neutral {
                // Neutral E2E host: the window stays on `about:blank`,
                // hidden, with nothing persisted and no menu installed
                // (mirrors `url: "about:blank"` + `hidden` in `index.ts`).
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.hide();
                    let blank = url::Url::parse("about:blank")
                        .map_err(|error| error.to_string())
                        .and_then(|url| main.navigate(url).map_err(|error| error.to_string()));
                    if let Err(error) = blank {
                        fail_startup(
                            app.handle(),
                            &format!("could not reset the main window: {error}"),
                        );
                        return Err("could not reset the main window".into());
                    }
                }
                // Readiness file once the sidecar is healthy (mirrors the
                // `dom-ready` `writeReady(THINKRAIL_DESKTOP_READY_FILE, ...)`
                // in `index.ts`: origin, windowUrl, mode, pid).
                if let Some(origin) = origin.as_deref() {
                    if let Ok(path) = std::env::var("THINKRAIL_DESKTOP_READY_FILE") {
                        if !path.is_empty() {
                            let payload = serde_json::json!({
                                "origin": origin,
                                "windowUrl": "about:blank",
                                "mode": "host",
                                "pid": std::process::id(),
                            });
                            if let Some(parent) = std::path::Path::new(&path).parent() {
                                if !parent.as_os_str().is_empty() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                            }
                            if let Err(error) = std::fs::write(
                                &path,
                                serde_json::to_string(&payload).unwrap_or_default(),
                            ) {
                                eprintln!("[desktop] could not write the ready file: {error}");
                            }
                        }
                    }
                }
            } else {
                // Point the main window at the sidecar origin plus the stored
                // initial route (`${origin}/${initialRoute}` in `index.ts`,
                // read from the route file under the backend profile/window
                // ids and falling back to `#/v1`).
                if let Some(origin) = origin.as_deref() {
                    let route = std::env::var_os("THINKRAIL_DESKTOP_USER_DATA")
                        .filter(|value| !value.is_empty())
                        .map(std::path::PathBuf::from)
                        .map(|dir| state::read_route_file(&dir, "local", "main"))
                        .unwrap_or_else(|| state::FALLBACK_ROUTE.to_owned());
                    let destination = format!("{origin}/{route}");
                    if let Some(main) = app.get_webview_window("main") {
                        match url::Url::parse(&destination) {
                            Ok(url) => {
                                if let Err(error) = main.navigate(url) {
                                    fail_startup(
                                        app.handle(),
                                        &format!("could not open the sidecar origin: {error}"),
                                    );
                                    return Err("could not open the sidecar origin".into());
                                }
                            }
                            Err(error) => {
                                fail_startup(
                                    app.handle(),
                                    &format!("could not build the sidecar URL: {error}"),
                                );
                                return Err("could not build the sidecar URL".into());
                            }
                        }
                    }
                }
                // `THINKRAIL_DESKTOP_HIDDEN=1` keeps the window hidden
                // (mirrors `hidden` in `index.ts`).
                if hidden {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.hide();
                    }
                }
            }
            // TODO: on the first `route_changed` (which already retires the
            // splash in `navigation.rs`, the dom-ready handoff), also call the
            // server startAttributionClaim equivalent
            // (`attributionClaimOnFirstReadiness(() =>
            // host.server.startAttributionClaim())` in `index.ts`). No Tauri
            // command or sidecar endpoint exposes it yet, so this stays
            // comment-only; invoke it best-effort once one exists.
            // Splash covers the main window until the first `route_changed`
            // report retires it (see `navigation.rs`).
            // TODO: localized splash message (native labels are not loaded yet).
            if !neutral {
                if let Err(error) = window::open_splash_window(app.handle(), "Starting ThinkRail…") {
                    eprintln!("[desktop] could not open the splash window: {error}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::Focused(focused) => {
                    use tauri::Emitter;
                    let _ = window.emit(
                        "windowFocusChanged",
                        serde_json::json!({ "focused": focused }),
                    );
                }
                tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    // Resizes can flip maximized/fullscreen; re-publish both
                    // the controls state and the content insets.
                    window::publish_window_state(window);
                    window::publish_window_chrome(window);
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the ThinkRail desktop app");
}
