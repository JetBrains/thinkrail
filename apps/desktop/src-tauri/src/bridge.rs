//! Bridge initialization script for the main window.
//!
//! The web client looks for frozen `__THINKRAIL_NATIVE_*__` globals. Under
//! Tauri they are installed by `apps/desktop/src/bridge/tauri-bootstrap.js`,
//! embedded here and registered as the main window's initialization script so
//! it runs at document start on the sidecar origin, before page scripts.
//!
//! The script is two seed globals followed by the bootstrap source, the same
//! assembly as `tauriInitializationScript` in `bridge/injection.ts` (which
//! exists so the TS tests can execute this exact source).

use std::collections::HashMap;

use tauri::{ipc::CapabilityBuilder, AppHandle, Manager};

use crate::window::WindowChromeSeed;

const BOOTSTRAP: &str = include_str!("../../src/bridge/tauri-bootstrap.js");

/// Mirror of `INITIAL_WINDOW_CHROME_GLOBAL` in `windowChrome.ts`.
const INITIAL_WINDOW_CHROME_GLOBAL: &str = "__THINKRAIL_INITIAL_WINDOW_CHROME__";
/// Mirror of `INITIAL_DESKTOP_PREFERENCES_GLOBAL` in `preferenceAdapter.ts`.
const INITIAL_DESKTOP_PREFERENCES_GLOBAL: &str = "__THINKRAIL_INITIAL_DESKTOP_PREFERENCES__";

/// Port of `serializeForPreload` in `preloadGlobals.ts`: a JSON document
/// wrapped as a JS string literal that cannot close a script element or end a
/// line early.
fn serialize_seed<T: serde::Serialize>(value: &T) -> String {
    let document = serde_json::to_string(value).unwrap_or_else(|_| "null".to_owned());
    serde_json::to_string(&document)
        .unwrap_or_else(|_| "\"null\"".to_owned())
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// Port of `prependPreloadGlobal`: one configurable global the bridge consumes.
fn seed_global_line<T: serde::Serialize>(name: &str, value: &T) -> String {
    format!(
        "Object.defineProperty(globalThis, {}, {{ value: JSON.parse({}), configurable: true }});",
        serde_json::Value::String(name.to_owned()),
        serialize_seed(value)
    )
}

/// The initialization script for one window: seeds, then the bridge source.
pub fn initialization_script(
    window_chrome: &WindowChromeSeed,
    preferences: &HashMap<String, String>,
) -> String {
    format!(
        "{}\n{}\n{BOOTSTRAP}",
        seed_global_line(INITIAL_WINDOW_CHROME_GLOBAL, window_chrome),
        seed_global_line(INITIAL_DESKTOP_PREFERENCES_GLOBAL, preferences),
    )
}

/// Let the page served from `origin` reach the bridge.
///
/// Tauri treats the sidecar's loopback origin as remote and rejects every
/// command and event subscription from it unless a capability names that
/// origin. The grant is created at runtime because the port is only known
/// once the sidecar reports it, and it covers exactly what the bootstrap
/// uses: the app commands in `permissions/bridge.toml` and event listening.
pub fn allow_bridge_from(app: &AppHandle, origin: &str) -> Result<(), String> {
    app.add_capability(
        CapabilityBuilder::new("sidecar-bridge")
            .local(false)
            .remote(format!("{origin}/*"))
            .window("main")
            .permission("bridge")
            .permission("core:event:allow-listen")
            .permission("core:event:allow-unlisten"),
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed() -> WindowChromeSeed {
        WindowChromeSeed {
            inset_left: 0,
            inset_right: 138,
            drag_region: true,
            window_controls: true,
        }
    }

    #[test]
    fn seeds_precede_the_bootstrap() {
        let preferences = HashMap::from([("theme".to_owned(), "dark".to_owned())]);
        let script = initialization_script(&seed(), &preferences);
        let mut lines = script.lines();
        assert_eq!(
            lines.next(),
            Some(
                "Object.defineProperty(globalThis, \"__THINKRAIL_INITIAL_WINDOW_CHROME__\", { value: JSON.parse(\"{\\\"insetLeft\\\":0,\\\"insetRight\\\":138,\\\"dragRegion\\\":true,\\\"windowControls\\\":true}\"), configurable: true });"
            )
        );
        assert_eq!(
            lines.next(),
            Some(
                "Object.defineProperty(globalThis, \"__THINKRAIL_INITIAL_DESKTOP_PREFERENCES__\", { value: JSON.parse(\"{\\\"theme\\\":\\\"dark\\\"}\"), configurable: true });"
            )
        );
        assert!(script.ends_with(BOOTSTRAP));
    }

    #[test]
    fn bootstrap_reads_the_seed_globals_this_module_writes() {
        for name in [
            INITIAL_WINDOW_CHROME_GLOBAL,
            INITIAL_DESKTOP_PREFERENCES_GLOBAL,
        ] {
            assert!(BOOTSTRAP.contains(&format!("\"{name}\"")), "{name}");
        }
    }

    #[test]
    fn seed_values_cannot_break_out_of_the_script() {
        let preferences = HashMap::from([(
            "note".to_owned(),
            "</script><script>\u{2028}\u{2029}\"\\".to_owned(),
        )]);
        let script = initialization_script(&seed(), &preferences);
        let line = script.lines().nth(1).expect("preferences seed line");
        assert!(!line.contains('<'));
        assert!(!line.contains('\u{2028}'));
        assert!(!line.contains('\u{2029}'));
        assert!(line.contains("\\u003c/script>"));
    }
}
