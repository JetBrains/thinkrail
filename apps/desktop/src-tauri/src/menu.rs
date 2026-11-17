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

use std::{collections::HashMap, fs, path::Path, sync::Mutex};

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
    ("desktop.menu.quit", "Quit Helios"),
    ("desktop.menu.window", "Window"),
    ("desktop.menu.close", "Close"),
];

/// Allowlisted dialog/splash keys with their `en.json` fallbacks, mirroring
/// `DESKTOP_DIALOG_KEYS` in `@thinkrail/locales`. The web client pushes these
/// alongside the menu labels (`pushNativeMenuLabels`), so they are sanitized
/// together.
const DIALOG_LABEL_DEFAULTS: [(&str, &str); 6] = [
    ("desktop.dialog.quit", "Quit"),
    ("desktop.dialog.startFailed", "Helios could not start"),
    (
        "desktop.dialog.updateRestartFailed",
        "Helios could not restart to install the update",
    ),
    (
        "desktop.dialog.updateRestartFailedTitle",
        "Helios Agent IDE could not restart",
    ),
    (
        "desktop.splash.finishingUpdate",
        "Finishing update to {{version}}…",
    ),
    ("desktop.splash.starting", "Starting Helios…"),
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

/// The caps are `value.length` in TypeScript, so count UTF-16 units: a byte
/// count would reject a 70-character Chinese label as "over 200".
fn sanitize_label(value: &str, cap: usize, fallback: &str) -> String {
    if value.trim().is_empty() || value.encode_utf16().count() > cap {
        fallback.to_owned()
    } else {
        value.to_owned()
    }
}

#[cfg(any(target_os = "macos", windows))]
fn menu_text(labels: &HashMap<String, String>, key: &str, fallback: &str) -> String {
    labels.get(key).cloned().unwrap_or_else(|| fallback.to_owned())
}

fn snapshot_labels(app: &AppHandle) -> HashMap<String, String> {
    app.try_state::<MenuLabels>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.clone()))
        .filter(|labels| !labels.is_empty())
        .unwrap_or_else(|| sanitize_menu_labels(HashMap::new()))
}

/// One native label (menu, dialog or splash text) in the user's language,
/// falling back to English until the web client has pushed its labels.
pub fn native_label(app: &AppHandle, key: &str) -> String {
    snapshot_labels(app).remove(key).unwrap_or_default()
}

/// File the last pushed labels are kept in (`nativeLabelsPath()` in
/// `index.ts`), so the next launch can caption its menu, splash and startup
/// dialog before the web client is up.
const NATIVE_LABELS_FILE: &str = "native-labels.json";

/// Port of `readNativeLabels`: a missing or corrupt file reads as no labels.
fn read_native_labels(user_data_dir: &Path) -> HashMap<String, String> {
    fs::read(user_data_dir.join(NATIVE_LABELS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.as_object().cloned())
        .map(|entries| {
            entries
                .into_iter()
                .filter_map(|(key, value)| Some((key, value.as_str()?.to_owned())))
                .collect()
        })
        .unwrap_or_default()
}

/// Port of `writeNativeLabels`: best-effort, a failure only costs the next
/// launch its translated captions.
fn write_native_labels(user_data_dir: &Path, labels: &HashMap<String, String>) {
    let written = fs::create_dir_all(user_data_dir).and_then(|()| {
        fs::write(
            user_data_dir.join(NATIVE_LABELS_FILE),
            serde_json::to_string(labels).unwrap_or_else(|_| "{}".to_owned()),
        )
    });
    if let Err(error) = written {
        eprintln!("[desktop] could not save the native labels: {error}");
    }
}

/// Load the labels saved by the previous run into [`MenuLabels`].
pub fn load_saved_labels(app: &AppHandle) {
    let saved = crate::state::user_data_dir(app)
        .map(|dir| read_native_labels(&dir))
        .unwrap_or_default();
    if let Some(state) = app.try_state::<MenuLabels>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = sanitize_menu_labels(saved);
        }
    }
}

#[tauri::command]
pub fn menu_labels_changed(
    app: AppHandle,
    labels: HashMap<String, String>,
) -> Result<(), String> {
    let labels = sanitize_menu_labels(labels);
    let changed = match app.try_state::<MenuLabels>() {
        Some(state) => {
            let mut guard = state.0.lock().map_err(|error| error.to_string())?;
            let changed = *guard != labels;
            *guard = labels.clone();
            changed
        }
        None => false,
    };
    // The web client pushes its labels on every start and language change;
    // only a real change is worth a file write and a menu rebuild.
    if !changed || crate::lifecycle::is_neutral_e2e_host() {
        return Ok(());
    }
    if let Some(dir) = crate::state::user_data_dir(&app) {
        write_native_labels(&dir, &labels);
    }
    build_native_menu(&app)
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
    let quit = menu_text(labels, "desktop.menu.quit", "Quit Helios");
    Submenu::with_items(
        app,
        "Helios",
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
/// `nativeCommand` events for the web shortcuts bridge, and `quit-shortcut`
/// quits. Call once at startup: the handler outlives menu rebuilds, and a
/// second registration would run every action twice.
///
/// Both a click on Quit and the Cmd-Q accelerator arrive here as the same
/// event. Electrobun tells them apart by reading the keyboard state
/// (`keyState.ts`) and makes the chord a press-and-hold confirmation; that
/// reader is not ported, so this takes the path `quitShortcut.ts` takes when
/// the key state is unavailable and quits at once. The host still gets its
/// orderly stop on the way out (`lifecycle::stop_host`).
pub fn register_menu_events(app: &AppHandle) {
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == OPEN_SETTINGS_COMMAND || id == CLOSE_ITEM_COMMAND {
            let _ = app.emit(
                "nativeCommand",
                serde_json::json!({ "command": id }),
            );
        } else if id == QUIT_SHORTCUT_ACTION {
            crate::lifecycle::quit_app(app.clone());
        }
    });
}

/// Build and install the native menu with the current labels: macOS
/// app/Edit/Window menus, Windows Edit menu only, nothing on Linux (mirroring
/// `desktopApplicationMenu`, which returns null there). Called again whenever
/// the labels change; installing replaces the previous menu.
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
            Some("Starting Helios…")
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
            ("desktop.menu.quit ", "Quit Helios"),
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
            Some("Helios could not start")
        );
    }

    #[test]
    fn caps_count_utf16_units_like_typescript() {
        // 70 Chinese characters are 210 UTF-8 bytes but 70 UTF-16 units:
        // within the 200 dialog cap, exactly as `value.length` sees them.
        let dialog = "退".repeat(70);
        let at_cap = "退".repeat(200);
        let over_cap = "退".repeat(201);
        let labels = sanitize_menu_labels(input(&[
            ("desktop.dialog.quit", dialog.as_str()),
            ("desktop.dialog.startFailed", at_cap.as_str()),
            ("desktop.splash.starting", over_cap.as_str()),
        ]));
        assert_eq!(labels.get("desktop.dialog.quit"), Some(&dialog));
        assert_eq!(labels.get("desktop.dialog.startFailed"), Some(&at_cap));
        assert_eq!(
            labels.get("desktop.splash.starting").map(String::as_str),
            Some("Starting Helios…")
        );
    }

    #[test]
    fn saved_labels_round_trip_and_tolerate_bad_files() {
        let dir = std::env::temp_dir().join(format!("thinkrail-labels-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert!(read_native_labels(&dir).is_empty());
        let labels = sanitize_menu_labels(input(&[("desktop.menu.edit", "Bearbeiten")]));
        write_native_labels(&dir, &labels);
        assert_eq!(read_native_labels(&dir), labels);
        fs::write(dir.join(NATIVE_LABELS_FILE), "not json").unwrap();
        assert!(read_native_labels(&dir).is_empty());
        fs::write(dir.join(NATIVE_LABELS_FILE), r#"{"desktop.menu.edit":7,"k":"v"}"#).unwrap();
        assert_eq!(read_native_labels(&dir), input(&[("k", "v")]));
        let _ = fs::remove_dir_all(&dir);
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
