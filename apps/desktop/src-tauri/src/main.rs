//! ThinkRail desktop shell (Tauri v2 migration).
//!
//! The ThinkRail host runs as an external sidecar binary
//! (`binaries/thinkrail-sidecar-<triple>`) that also serves the web UI
//! (`apps/web`). The shell spawns it at startup ([`sidecar`], [`startup`])
//! and opens the main window on its loopback origin. Native menus come from
//! `tauri::menu` in the core crate.
//!
//! The bridge script ([`bridge`]) installs the same frozen globals the
//! Electrobun preload did; commands and events below keep the Electrobun RPC
//! message names (`get_window_state`, `updateStateChanged`, …) so the web
//! shape-guards accept the Tauri shell unchanged. Every command the page may
//! call must also be listed in `permissions/bridge.toml`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod lifecycle;
mod menu;
mod navigation;
mod sidecar;
mod startup;
mod state;
mod updates_tauri;
mod window;

use tauri::Emitter;
use tauri_plugin_window_state::StateFlags;

fn main() {
    let app = tauri::Builder::default()
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
        .plugin(
            // Size and position are restored; visibility is the shell's call
            // (the main window stays hidden until its page has loaded, and
            // for good under `THINKRAIL_DESKTOP_HIDDEN`). The splash is
            // always centered at a fixed size.
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_denylist(&[window::SPLASH_WINDOW])
                .build(),
        )
        .manage(state::PreferenceStore::default())
        .manage(menu::MenuLabels::default())
        .manage(updates_tauri::UpdateState::default())
        .manage(sidecar::SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            window::get_window_state,
            window::minimize_window,
            window::toggle_maximize_window,
            window::close_window,
            window::start_window_drag,
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
        ])
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            updates_tauri::enable_if_configured(app.handle());
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
            // arrive before the page can receive them are buffered until it
            // reports `deep_link_ready`.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if let Err(error) = navigation::forward_deep_link(&handle, url.as_str()) {
                            eprintln!("[desktop] ignoring invalid deep link: {error}");
                        }
                    }
                });
            }
            startup::begin(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != window::MAIN_WINDOW {
                return;
            }
            match event {
                tauri::WindowEvent::Focused(focused) => {
                    let _ = window.emit(
                        "windowFocusChanged",
                        serde_json::json!({ "focused": focused }),
                    );
                }
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    // Resizes can flip maximized/fullscreen; re-publish both
                    // the controls state and the content insets.
                    window::publish_window_state(window);
                    window::publish_window_chrome(window);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the ThinkRail desktop app");

    app.run(|app, event| {
        // Tauri ends the process with `std::process::exit` once this returns,
        // which runs no destructors: stop the host here or it is orphaned.
        if let tauri::RunEvent::Exit = event {
            lifecycle::stop_host(app);
        }
    });
}
