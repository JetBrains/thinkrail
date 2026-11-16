//! Native application menu.
//!
//! Menus come from `tauri::menu` in the core crate (there is no separate
//! menu plugin). Label updates arrive from the web client through
//! `menu_labels_changed` (Electrobun `menuLabelsChanged` parity) and are
//! sanitized like the Electrobun main process does (`readMenuLabels` in
//! `applicationMenu.ts`, length caps from `nativeLabels.ts`).
//!
//! Menu structure ports `desktopApplicationMenu` in `applicationMenu.ts`:
//! macOS gets the app menu (About/Settings/Hide/Quit), the Edit menu, and
//! the Window menu; Windows gets the Edit menu only; Linux installs no menu
//! (the TS port returns null there).

use std::{collections::HashMap, sync::Mutex};

use tauri::{AppHandle, Emitter, Manager};

/// Menu ids the web client reacts to, mirroring `OPEN_SETTINGS_COMMAND`,
/// `CLOSE_ITEM_COMMAND`, and `QUIT_SHORTCUT_ACTION` in `applicationMenu.ts`.
pub const OPEN_SETTINGS_COMMAND: &str = "open-settings";
pub const CLOSE_ITEM_COMMAND: &str = "close-item";
pub const QUIT_SHORTCUT_ACTION: &str = "quit-shortcut";

/// Mirror of `MAX_MENU_LABEL_LENGTH` in `applicationMenu.ts`.
const MAX_MENU_LABEL_LENGTH: usize = 80;
/// Mirror of `MAX_DIALOG_LABEL_LENGTH` in `nativeLabels.ts`.
const MAX_DIALOG_LABEL_LENGTH: usize = 200;

/// Allowlisted menu keys with their `en.json` fallbacks, mirroring
/// `DESKTOP_MENU_KEYS` in `@thinkrail/locales`.
const MENU_LABEL_DEFAULTS: [(&str, &str); 5] = [
    ("desktop.menu.edit", "Edit"),
    ("desktop.menu.settings", "Settings…"),
    ("desktop.menu.quit", "Quit ThinkRail"),
    ("desktop.menu.window", "Window"),
    ("desktop.menu.close", "Close"),
];

/// Allowlisted dialog/splash keys with their `en.json` fallbacks, mirroring
/// `DESKTOP_DIALOG_KEYS` in `@thinkrail/locales`. The web client pushes these
/// alongside the menu labels (`pushNativeMenuLabels`), so they are sanitized
/// together.
const DIALOG_LABEL_DEFAULTS: [(&str, &str); 6] = [
    ("desktop.dialog.quit", "Quit"),
    ("desktop.dialog.startFailed", "ThinkRail could not start"),
    (
        "desktop.dialog.updateRestartFailed",
        "ThinkRail could not restart to install the update",
    ),
    (
        "desktop.dialog.updateRestartFailedTitle",
        "ThinkRail could not restart",
    ),
    (
        "desktop.splash.finishingUpdate",
        "Finishing update to {{version}}…",
    ),
    ("desktop.splash.starting", "Starting ThinkRail…"),
];

#[derive(Default)]
pub struct MenuLabels(pub Mutex<HashMap<String, String>>);

/// Port of `readLabels`/`readMenuLabels` in `applicationMenu.ts` +
/// `nativeLabels.ts`: keep only allowlisted keys (drop everything else),
/// reject blank or overlong values back to the English default, and fill
/// missing keys with their defaults so the stored map is always complete.
pub fn sanitize_menu_labels(labels: HashMap<String, String>) -> HashMap<String, String> {
    let mut clean =
        HashMap::with_capacity(MENU_LABEL_DEFAULTS.len() + DIALOG_LABEL_DEFAULTS.len());
    for (key, fallback) in MENU_LABEL_DEFAULTS
        .iter()
        .copied()
        .chain(DIALOG_LABEL_DEFAULTS.iter().copied())
    {
        let cap = if key.starts_with("desktop.menu.") {
            MAX_MENU_LABEL_LENGTH
        } else {
            MAX_DIALOG_LABEL_LENGTH
        };
        let value = labels.get(key).map(String::as_str).unwrap_or("");
        clean.insert(key.to_owned(), sanitize_label(value, cap, fallback));
    }
    clean
}

fn sanitize_label(value: &str, cap: usize, fallback: &str) -> String {
    if value.trim().is_empty() || value.len() > cap {
        fallback.to_owned()
    } else {
        value.to_owned()
    }
}

fn menu_text(labels: &HashMap<String, String>, key: &str, fallback: &str) -> String {
    labels.get(key).cloned().unwrap_or_else(|| fallback.to_owned())
}

fn snapshot_labels(app: &AppHandle) -> HashMap<String, String> {
    app.try_state::<MenuLabels>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.clone()))
        .unwrap_or_else(|| sanitize_menu_labels(HashMap::new()))
}

#[tauri::command]
pub fn menu_labels_changed(
    app: AppHandle,
    labels: HashMap<String, String>,
) -> Result<(), String> {
    let labels = sanitize_menu_labels(labels);
    if let Some(state) = app.try_state::<MenuLabels>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = labels;
        }
    }
    // TODO: rebuild the native menu so the new labels take effect without a
    // restart (needs the `AppHandle` menu item handles or a rebuild call).
    Ok(())
}

/// Edit submenu shared by macOS and Windows, mirroring `editMenu` in
/// `applicationMenu.ts`. There is no muda equivalent for the `delete` and
/// `pasteAndMatchStyle` roles, so they are omitted (both remain available
/// through the keyboard while editing text).
#[cfg(any(target_os = "macos", windows))]
fn edit_submenu(
    app: &AppHandle,
    labels: &HashMap<String, String>,
) -> Result<tauri::menu::Submenu<tauri::Wry>, String> {
    use tauri::menu::{PredefinedMenuItem, Submenu};

    let edit = menu_text(labels, "desktop.menu.edit", "Edit");
    Submenu::with_items(
        app,
        edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::redo(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::cut(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::copy(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::paste(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::select_all(app, None).map_err(|error| error.to_string())?,
        ],
    )
    .map_err(|error| error.to_string())
}

/// Application submenu (macOS only): About, Settings (Cmd-,), Hide/Hide
/// Others/Show All, and the quit-shortcut item (Cmd-Q). Quit stays a custom
/// `quit-shortcut` item instead of the native quit role so it flows through
/// the same confirmation path as the Cmd-Q chord (`quitShortcut.ts`).
#[cfg(target_os = "macos")]
fn application_submenu(
    app: &AppHandle,
    labels: &HashMap<String, String>,
) -> Result<tauri::menu::Submenu<tauri::Wry>, String> {
    use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

    let settings = menu_text(labels, "desktop.menu.settings", "Settings…");
    let quit = menu_text(labels, "desktop.menu.quit", "Quit ThinkRail");
    Submenu::with_items(
        app,
        "ThinkRail",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            &MenuItem::with_id(
                app,
                OPEN_SETTINGS_COMMAND,
                settings,
                true,
                Some("CommandOrControl+,"),
            )
            .map_err(|error| error.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::hide(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::hide_others(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::show_all(app, None).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            &MenuItem::with_id(
                app,
                QUIT_SHORTCUT_ACTION,
                quit,
                true,
                Some("CommandOrControl+Q"),
            )
            .map_err(|error| error.to_string())?,
        ],
    )
    .map_err(|error| error.to_string())
}

/// Window submenu (macOS only): Minimize (Cmd-M), Zoom, Close (Cmd-W), and
/// Bring All to Front. Close stays a custom `close-item` action for the web
/// shortcut layer (`shortcutCommands.ts`) instead of the native close role.
#[cfg(target_os = "macos")]
fn window_submenu(
    app: &AppHandle,
    labels: &HashMap<String, String>,
) -> Result<tauri::menu::Submenu<tauri::Wry>, String> {
    use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};

    let window = menu_text(labels, "desktop.menu.window", "Window");
    let close = menu_text(labels, "desktop.menu.close", "Close");
    Submenu::with_items(
        app,
        window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, None).map_err(|error| error.to_string())?,
            // Closest match for Electron's `zoom` role (toggle zoom).
            &PredefinedMenuItem::maximize(app, None).map_err(|error| error.to_string())?,
            &MenuItem::with_id(
                app,
                CLOSE_ITEM_COMMAND,
                close,
                true,
                Some("CommandOrControl+W"),
            )
            .map_err(|error| error.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::bring_all_to_front(app, None)
                .map_err(|error| error.to_string())?,
        ],
    )
    .map_err(|error| error.to_string())
}

/// Route custom menu actions: `open-settings`/`close-item` are forwarded as
/// `nativeCommand` events for the web shortcuts bridge (`bridge.ts`), and
/// `quit-shortcut` quits through the same path as the welcome flow.
fn register_menu_events(app: &AppHandle) {
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == OPEN_SETTINGS_COMMAND || id == CLOSE_ITEM_COMMAND {
            let _ = app.emit(
                "nativeCommand",
                serde_json::json!({ "command": id }),
            );
        } else if id == QUIT_SHORTCUT_ACTION {
            // A native menu pick is already an explicit gesture, so quit
            // immediately like Electrobun's `menuPick → quitNow` path (the
            // press-and-hold confirmation only applies to the Cmd-Q chord).
            crate::lifecycle::quit_app(app.clone());
        }
    });
}

/// Build and install the native menu: macOS app/Edit/Window menus, Windows
/// Edit menu only, nothing on Linux (mirroring `desktopApplicationMenu`,
/// which returns null there).
pub fn build_native_menu(app: &AppHandle) -> Result<(), String> {
    // Linux has no global menubar to populate; report success without one.
    if cfg!(target_os = "linux") {
        return Ok(());
    }
    use tauri::menu::Menu;

    let labels = snapshot_labels(app);
    let menu = Menu::new(app).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let application = application_submenu(app, &labels)?;
        menu.append(&application)
            .map_err(|error| error.to_string())?;
    }
    #[cfg(any(target_os = "macos", windows))]
    {
        let edit = edit_submenu(app, &labels)?;
        menu.append(&edit).map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let window = window_submenu(app, &labels)?;
        menu.append(&window).map_err(|error| error.to_string())?;
    }
    app.set_menu(menu).map_err(|error| error.to_string())?;
    register_menu_events(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn keeps_allowlisted_labels_and_fills_missing_defaults() {
        let labels = sanitize_menu_labels(input(&[
            ("desktop.menu.edit", "Bearbeiten"),
            ("desktop.dialog.quit", "Beenden"),
        ]));
        assert_eq!(labels.get("desktop.menu.edit").map(String::as_str), Some("Bearbeiten"));
        assert_eq!(labels.get("desktop.dialog.quit").map(String::as_str), Some("Beenden"));
        // Missing keys fall back to the English defaults, like `readLabels`.
        assert_eq!(labels.get("desktop.menu.window").map(String::as_str), Some("Window"));
        assert_eq!(
            labels.get("desktop.splash.starting").map(String::as_str),
            Some("Starting ThinkRail…")
        );
        // Full coverage: every allowlisted key is present.
        assert_eq!(
            labels.len(),
            MENU_LABEL_DEFAULTS.len() + DIALOG_LABEL_DEFAULTS.len()
        );
    }

    #[test]
    fn drops_unknown_keys() {
        let labels = sanitize_menu_labels(input(&[
            ("desktop.menu.edit", "Edit"),
            ("attacker.key", "evil"),
            ("desktop.menu.quit ", "Quit ThinkRail"),
        ]));
        assert!(!labels.contains_key("attacker.key"));
        assert!(!labels.contains_key("desktop.menu.quit "));
        assert_eq!(
            labels.len(),
            MENU_LABEL_DEFAULTS.len() + DIALOG_LABEL_DEFAULTS.len()
        );
    }

    #[test]
    fn caps_lengths_per_group() {
        // Menu cap is 80: an 81-char menu label falls back, an 80-char one stays.
        let long_menu = "m".repeat(81);
        let max_menu = "m".repeat(80);
        // Dialog cap is 200: a 150-char dialog label stays, a 201-char one falls back.
        let mid_dialog = "d".repeat(150);
        let long_dialog = "d".repeat(201);
        let labels = sanitize_menu_labels(input(&[
            ("desktop.menu.edit", max_menu.as_str()),
            ("desktop.menu.close", long_menu.as_str()),
            ("desktop.dialog.quit", mid_dialog.as_str()),
            ("desktop.dialog.startFailed", long_dialog.as_str()),
        ]));
        assert_eq!(labels.get("desktop.menu.edit").map(String::as_str), Some(max_menu.as_str()));
        assert_eq!(labels.get("desktop.menu.close").map(String::as_str), Some("Close"));
        assert_eq!(
            labels.get("desktop.dialog.quit").map(String::as_str),
            Some(mid_dialog.as_str())
        );
        assert_eq!(
            labels.get("desktop.dialog.startFailed").map(String::as_str),
            Some("ThinkRail could not start")
        );
    }

    #[test]
    fn rejects_blank_labels() {
        let labels = sanitize_menu_labels(input(&[
            ("desktop.menu.edit", ""),
            ("desktop.menu.close", "   "),
        ]));
        assert_eq!(labels.get("desktop.menu.edit").map(String::as_str), Some("Edit"));
        assert_eq!(labels.get("desktop.menu.close").map(String::as_str), Some("Close"));
    }
}
