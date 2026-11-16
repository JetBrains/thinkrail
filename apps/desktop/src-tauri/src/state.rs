//! Web-client state owned by the shell: stable preferences and last routes.
//!
//! Mirrors the validation bounds in `preferenceAdapter.ts` (keys are short
//! control-character-free strings, values are bounded blobs) and the on-disk
//! formats of `PreferenceStore` (`preferences.json`) and `RouteStore`
//! (`routes.json`) under the user-data directory (`apps/desktop/src/index.ts`).
//!
//! The `preference_write` / `preference_remove` commands keep their bridge
//! signatures. When `THINKRAIL_DESKTOP_USER_DATA` names a user-data directory
//! (the same override `desktopUserData()` honors in the Electrobun entry),
//! each command loads the v1 preference document and persists the mutation
//! with an atomic tmp-file + rename; without the override the store stays in
//! memory, as before.

use std::{
    collections::{BTreeMap, HashMap},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_KEY_LEN: usize = 128;
const MAX_VALUE_LEN: usize = 256 * 1024;

#[derive(Default)]
pub struct PreferenceStore(pub Mutex<HashMap<String, String>>);

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY_LEN && !key.chars().any(|c| c.is_control())
}

fn valid_value(value: &str) -> bool {
    value.len() <= MAX_VALUE_LEN
}

#[tauri::command]
pub fn preference_write(
    state: tauri::State<'_, PreferenceStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    // Invalid writes are ignored, matching the Electrobun main process.
    if !valid_key(&key) || !valid_value(&value) {
        return Ok(());
    }
    // Disk persistence underneath: the v1 document is the source of truth
    // whenever the user-data override resolves, and memory is refreshed from
    // it so concurrent writers cannot clobber each other.
    if let Some(dir) = resolve_user_data_dir() {
        if write_prefs(
            &dir,
            DEFAULT_BACKEND_PROFILE_ID,
            DEFAULT_WINDOW_ID,
            &key,
            &value,
        ) {
            if let Ok(mut store) = state.0.lock() {
                *store = read_prefs(&dir, DEFAULT_BACKEND_PROFILE_ID, DEFAULT_WINDOW_ID);
            }
            return Ok(());
        }
    }
    if let Ok(mut store) = state.0.lock() {
        store.insert(key, value);
    }
    Ok(())
}

#[tauri::command]
pub fn preference_remove(
    state: tauri::State<'_, PreferenceStore>,
    key: String,
) -> Result<(), String> {
    if !valid_key(&key) {
        return Ok(());
    }
    if let Some(dir) = resolve_user_data_dir() {
        if remove_prefs(&dir, DEFAULT_BACKEND_PROFILE_ID, DEFAULT_WINDOW_ID, &key) {
            if let Ok(mut store) = state.0.lock() {
                *store = read_prefs(&dir, DEFAULT_BACKEND_PROFILE_ID, DEFAULT_WINDOW_ID);
            }
            return Ok(());
        }
    }
    if let Ok(mut store) = state.0.lock() {
        store.remove(&key);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Shared file helpers
// ---------------------------------------------------------------------------

/// Serialize like `JSON.stringify(document, null, "\t")` with a trailing
/// newline. Only line-leading spaces are rewritten, which is safe because
/// `serde_json` escapes newlines inside strings.
fn to_tab_json(value: &serde_json::Value) -> String {
    let pretty = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_owned());
    let mut out = String::with_capacity(pretty.len() + 1);
    for line in pretty.split('\n') {
        let spaces = line.bytes().take_while(|byte| *byte == b' ').count();
        out.push_str(&"\t".repeat(spaces / 2));
        out.push_str(&line[spaces..]);
        out.push('\n');
    }
    out
}

/// Best-effort atomic file write (tmp-file + rename), mirroring the journal
/// store's `partial` + `renameSync` semantics. Parent directories are created
/// like the TS stores' `mkdirSync(..., { recursive: true })`.
fn atomic_write(path: &Path, bytes: &[u8]) -> bool {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && fs::create_dir_all(parent).is_err() {
            return false;
        }
    }
    let mut tmp: OsString = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    if fs::write(&tmp, bytes).is_err() {
        let _ = fs::remove_file(&tmp);
        return false;
    }
    if fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(&tmp);
        return false;
    }
    true
}

/// Length in UTF-16 code units, matching TypeScript's `string.length`.
fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

/// Mirror of `hasControlCharacter` in `routeStore.ts` / `preferenceAdapter.ts`:
/// code units `<= 31` or `== 127` (surrogates cannot occur in Rust `str`).
fn has_control_character(value: &str) -> bool {
    value
        .chars()
        .any(|c| (c as u32) <= 0x1F || (c as u32) == 0x7F)
}

/// `encodeURIComponent` without new dependencies: leaves
/// `A-Za-z0-9 -_.!~*'()` bare, percent-encodes UTF-8 bytes of the rest.
fn encode_uri_component(value: &str) -> String {
    const UNRESERVED: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if UNRESERVED.contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `decodeURIComponent` semantics: `+` stays literal, malformed `%`
/// sequences fail the whole value.
fn decode_uri_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                if index + 2 >= bytes.len() {
                    return None;
                }
                let hex = |byte: u8| (byte as char).to_digit(16);
                match (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                    (Some(high), Some(low)) => {
                        out.push((high * 16 + low) as u8);
                        index += 3;
                    }
                    _ => return None,
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

// ---------------------------------------------------------------------------
// RouteStore port (`routes.json`)
// ---------------------------------------------------------------------------

/// File name used by `new RouteStore(join(userData, "routes.json"))`.
pub const ROUTES_FILE: &str = "routes.json";
const ROUTE_VERSION: u32 = 1;
/// Fallback route when nothing valid is stored (`FALLBACK_ROUTE`).
pub const FALLBACK_ROUTE: &str = "#/v1";
/// Mirror of `MAX_ROUTE_LENGTH`.
const MAX_ROUTE_LENGTH: usize = 4096;

fn valid_route(value: &str) -> bool {
    value.starts_with('#')
        && utf16_len(value) <= MAX_ROUTE_LENGTH
        && !has_control_character(value)
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct RouteDocument {
    version: u32,
    #[serde(default)]
    routes: BTreeMap<String, String>,
}

fn read_route_document(path: &Path) -> RouteDocument {
    let empty = RouteDocument {
        version: ROUTE_VERSION,
        routes: BTreeMap::new(),
    };
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return empty,
    };
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return empty,
    };
    if value.get("version").and_then(|entry| entry.as_u64()) != Some(ROUTE_VERSION as u64) {
        return empty;
    }
    let routes = match value.get("routes") {
        Some(routes) if routes.is_object() => routes,
        _ => return empty,
    };
    let mut document = RouteDocument {
        version: ROUTE_VERSION,
        routes: BTreeMap::new(),
    };
    for (key, route) in routes.as_object().expect("checked is_object") {
        if let Some(route) = route.as_str() {
            if valid_route(route) {
                document.routes.insert(key.clone(), route.to_owned());
            }
        }
    }
    document
}

/// Path of the route file under a user-data directory.
pub fn routes_file_path(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join(ROUTES_FILE)
}

/// Port of `RouteStore.read`: stored hash for `{profile}:{window}`, or `#/v1`.
pub fn read_route_file(
    user_data_dir: &Path,
    backend_profile_id: &str,
    window_id: &str,
) -> String {
    read_route_document(&routes_file_path(user_data_dir))
        .routes
        .get(&format!("{backend_profile_id}:{window_id}"))
        .cloned()
        .unwrap_or_else(|| FALLBACK_ROUTE.to_owned())
}

/// Port of `RouteStore.write`: validates, skips no-op rewrites, and persists
/// atomically. Returns `false` for invalid routes (nothing is written).
pub fn write_route_file(
    user_data_dir: &Path,
    backend_profile_id: &str,
    window_id: &str,
    route: &str,
) -> bool {
    if !valid_route(route) {
        return false;
    }
    let path = routes_file_path(user_data_dir);
    let mut document = read_route_document(&path);
    let key = format!("{backend_profile_id}:{window_id}");
    if document.routes.get(&key).is_some_and(|entry| entry == route) {
        return true;
    }
    document.routes.insert(key, route.to_owned());
    let value = serde_json::to_value(&document).unwrap_or(serde_json::Value::Null);
    atomic_write(&path, to_tab_json(&value).as_bytes())
}

// ---------------------------------------------------------------------------
// PreferenceStore port (`preferences.json`)
// ---------------------------------------------------------------------------

/// File name used by `new PreferenceStore(join(userData, "preferences.json"))`.
pub const PREFERENCES_FILE: &str = "preferences.json";
const PREFERENCE_VERSION: u32 = 1;
const MAX_PREFERENCE_SCOPES: usize = 32;
const MAX_PREFERENCES: usize = 256;
const MAX_PREFERENCE_DOCUMENT_BYTES: u64 = 1024 * 1024;
const MAX_ENCODED_SCOPE_KEY_LENGTH: usize = 4096;
const MAX_SCOPE_ID_LENGTH: usize = 128;

/// Backend profile / window identity the unscoped bridge commands persist
/// under (`BACKEND_PROFILE_ID` / `WINDOW_ID` in `apps/desktop/src/index.ts`).
const DEFAULT_BACKEND_PROFILE_ID: &str = "local";
const DEFAULT_WINDOW_ID: &str = "main";

fn valid_pref_key(key: &str) -> bool {
    !key.is_empty() && utf16_len(key) <= MAX_KEY_LEN && !has_control_character(key)
}

fn valid_pref_value(value: &str) -> bool {
    utf16_len(value) <= MAX_VALUE_LEN
}

fn valid_scope_id(id: &str) -> bool {
    !id.is_empty() && utf16_len(id) <= MAX_SCOPE_ID_LENGTH && !has_control_character(id)
}

/// Port of `scopeKey`: `encodeURIComponent(profile):encodeURIComponent(window)`.
fn prefs_scope_key(backend_profile_id: &str, window_id: &str) -> Option<String> {
    if !valid_scope_id(backend_profile_id) || !valid_scope_id(window_id) {
        return None;
    }
    Some(format!(
        "{}:{}",
        encode_uri_component(backend_profile_id),
        encode_uri_component(window_id)
    ))
}

/// Port of `validPersistedScopeKey`: exactly one colon, round-trips through
/// decode/encode so only genuinely encoded scope keys validate.
fn valid_persisted_scope_key(value: &str) -> bool {
    if value.is_empty() || utf16_len(value) > MAX_ENCODED_SCOPE_KEY_LENGTH {
        return false;
    }
    // Encoded ids never contain a bare `:`, so there must be exactly one.
    if value.bytes().filter(|byte| *byte == b':').count() != 1 {
        return false;
    }
    let (raw_profile, raw_window) = value.split_once(':').expect("checked count");
    if raw_profile.is_empty() || raw_window.is_empty() {
        return false;
    }
    match (
        decode_uri_component(raw_profile),
        decode_uri_component(raw_window),
    ) {
        (Some(profile), Some(window)) => {
            prefs_scope_key(&profile, &window).as_deref() == Some(value)
        }
        _ => false,
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct PreferenceDocument {
    version: u32,
    #[serde(default)]
    preferences: BTreeMap<String, BTreeMap<String, String>>,
}

fn empty_preference_document() -> PreferenceDocument {
    PreferenceDocument {
        version: PREFERENCE_VERSION,
        preferences: BTreeMap::new(),
    }
}

/// Port of `readDocument`: version/cap-validated, invalid scopes and entries
/// skipped, never throws (falls back to an empty document).
fn read_preference_document(path: &Path) -> PreferenceDocument {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return empty_preference_document(),
    };
    if bytes.len() as u64 > MAX_PREFERENCE_DOCUMENT_BYTES {
        return empty_preference_document();
    }
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return empty_preference_document(),
    };
    if value.get("version").and_then(|entry| entry.as_u64())
        != Some(PREFERENCE_VERSION as u64)
    {
        return empty_preference_document();
    }
    let stored = match value.get("preferences") {
        Some(stored) if stored.is_object() => stored,
        _ => return empty_preference_document(),
    };
    let mut document = empty_preference_document();
    let mut total = 0usize;
    for (scope_key, stored_prefs) in stored.as_object().expect("checked is_object") {
        if document.preferences.len() >= MAX_PREFERENCE_SCOPES || total >= MAX_PREFERENCES {
            break;
        }
        if !valid_persisted_scope_key(scope_key) {
            continue;
        }
        let entries = match stored_prefs.as_object() {
            Some(entries) => entries,
            None => continue,
        };
        let mut scope = BTreeMap::new();
        for (key, preference) in entries {
            if total >= MAX_PREFERENCES {
                break;
            }
            match preference.as_str() {
                Some(value) if valid_pref_key(key) && valid_pref_value(value) => {
                    scope.insert(key.clone(), value.to_owned());
                    total += 1;
                }
                _ => continue,
            }
        }
        if !scope.is_empty() {
            document.preferences.insert(scope_key.clone(), scope);
        }
    }
    document
}

fn total_preference_count(document: &PreferenceDocument) -> usize {
    document
        .preferences
        .values()
        .map(|scope| scope.len())
        .sum()
}

/// Port of `persistDocument`: byte-cap check, then an atomic tmp-file +
/// rename (the TS store writes directly; atomic is strictly safer).
fn persist_preference_document(path: &Path, document: &PreferenceDocument) -> bool {
    let value = serde_json::to_value(document).unwrap_or(serde_json::Value::Null);
    let serialized = to_tab_json(&value);
    if serialized.len() as u64 > MAX_PREFERENCE_DOCUMENT_BYTES {
        return false;
    }
    atomic_write(path, serialized.as_bytes())
}

/// Path of the preferences file under a user-data directory.
pub fn prefs_file_path(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join(PREFERENCES_FILE)
}

/// User-data directory override shared with the Electrobun entry
/// (`desktopUserData()`): `THINKRAIL_DESKTOP_USER_DATA` or unset.
fn resolve_user_data_dir() -> Option<PathBuf> {
    std::env::var_os("THINKRAIL_DESKTOP_USER_DATA")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Port of `PreferenceStore.read`: scoped preferences, `{}` for bad scopes.
pub fn read_prefs(
    user_data_dir: &Path,
    backend_profile_id: &str,
    window_id: &str,
) -> HashMap<String, String> {
    let Some(scope) = prefs_scope_key(backend_profile_id, window_id) else {
        return HashMap::new();
    };
    read_preference_document(&prefs_file_path(user_data_dir))
        .preferences
        .get(&scope)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .collect()
}

/// Port of `PreferenceStore.write`: validates ids/key/value and the
/// scope/total caps, then persists atomically.
pub fn write_prefs(
    user_data_dir: &Path,
    backend_profile_id: &str,
    window_id: &str,
    key: &str,
    value: &str,
) -> bool {
    let Some(scope) = prefs_scope_key(backend_profile_id, window_id) else {
        return false;
    };
    if !valid_pref_key(key) || !valid_pref_value(value) {
        return false;
    }
    let path = prefs_file_path(user_data_dir);
    let mut document = read_preference_document(&path);
    let existing = document
        .preferences
        .get(&scope)
        .and_then(|entries| entries.get(key));
    if matches!(existing, Some(entry) if entry == value) {
        return true;
    }
    if existing.is_none() {
        if total_preference_count(&document) >= MAX_PREFERENCES {
            return false;
        }
        if !document.preferences.contains_key(&scope)
            && document.preferences.len() >= MAX_PREFERENCE_SCOPES
        {
            return false;
        }
    }
    document
        .preferences
        .entry(scope)
        .or_default()
        .insert(key.to_owned(), value.to_owned());
    persist_preference_document(&path, &document)
}

/// Port of `PreferenceStore.remove`: `true` when absent (nothing to do) or
/// removed and persisted.
pub fn remove_prefs(
    user_data_dir: &Path,
    backend_profile_id: &str,
    window_id: &str,
    key: &str,
) -> bool {
    let Some(scope) = prefs_scope_key(backend_profile_id, window_id) else {
        return false;
    };
    if !valid_pref_key(key) {
        return false;
    }
    let path = prefs_file_path(user_data_dir);
    let mut document = read_preference_document(&path);
    let present = document
        .preferences
        .get(&scope)
        .is_some_and(|entries| entries.contains_key(key));
    if !present {
        return true;
    }
    if let Some(entries) = document.preferences.get_mut(&scope) {
        entries.remove(key);
        if entries.is_empty() {
            document.preferences.remove(&scope);
        }
    }
    persist_preference_document(&path, &document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn unique_temp_dir(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "thinkrail-state-{}-{}-{}",
            tag,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn route_round_trip() {
        let dir = unique_temp_dir("route");
        // Missing file falls back.
        assert_eq!(read_route_file(&dir, "local", "main"), "#/v1");
        assert!(write_route_file(&dir, "local", "main", "#/v1/chat"));
        assert_eq!(read_route_file(&dir, "local", "main"), "#/v1/chat");
        // Scoped per `{profile}:{window}`.
        assert_eq!(read_route_file(&dir, "local", "other"), "#/v1");
        assert!(write_route_file(&dir, "local", "other", "#/v1/settings"));
        assert_eq!(read_route_file(&dir, "local", "other"), "#/v1/settings");
        assert_eq!(read_route_file(&dir, "local", "main"), "#/v1/chat");
        // No stray tmp file left behind.
        assert!(!routes_file_path(&dir).with_extension("tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn route_rejects_invalid_hashes() {
        let dir = unique_temp_dir("route-invalid");
        assert!(write_route_file(&dir, "local", "main", "#/v1/chat"));
        for bad in [
            "no-hash-prefix",
            "#/has\u{0}control",
            &"#".repeat(MAX_ROUTE_LENGTH + 1),
        ] {
            assert!(!write_route_file(&dir, "local", "main", bad), "{bad:?}");
        }
        // Stored value is untouched.
        assert_eq!(read_route_file(&dir, "local", "main"), "#/v1/chat");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn route_filters_invalid_entries() {
        let dir = unique_temp_dir("route-filter");
        let path = routes_file_path(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            &path,
            serde_json::json!({ "version": 1, "routes": {
                "local:main": "#/v1/kept",
                "local:other": "missing-hash",
            } })
            .to_string(),
        )
        .unwrap();
        assert_eq!(read_route_file(&dir, "local", "main"), "#/v1/kept");
        assert_eq!(read_route_file(&dir, "local", "other"), "#/v1");
        // Corrupt / wrong-version documents fall back.
        fs::write(&path, "not json").unwrap();
        assert_eq!(read_route_file(&dir, "local", "main"), "#/v1");
        fs::write(
            &path,
            serde_json::json!({ "version": 2, "routes": { "local:main": "#/v1/a" } })
                .to_string(),
        )
        .unwrap();
        assert_eq!(read_route_file(&dir, "local", "main"), "#/v1");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefs_round_trip_with_encoding() {
        let dir = unique_temp_dir("prefs");
        assert!(read_prefs(&dir, "local", "main").is_empty());
        assert!(write_prefs(&dir, "local", "main", "theme", "dark"));
        assert_eq!(
            read_prefs(&dir, "local", "main"),
            HashMap::from([("theme".to_owned(), "dark".to_owned())])
        );
        // Scope keys are `encodeURIComponent`d like the TS store.
        assert!(write_prefs(&dir, "pro/file", "win dow", "k", "v"));
        let raw: serde_json::Value =
            serde_json::from_slice(&fs::read(prefs_file_path(&dir)).unwrap()).unwrap();
        assert_eq!(raw["version"], 1);
        assert_eq!(
            raw["preferences"]["pro%2Ffile:win%20dow"]["k"],
            serde_json::Value::String("v".to_owned())
        );
        assert_eq!(
            read_prefs(&dir, "pro/file", "win dow"),
            HashMap::from([("k".to_owned(), "v".to_owned())])
        );
        // Removal drops the key, then the emptied scope.
        assert!(remove_prefs(&dir, "local", "main", "theme"));
        assert!(read_prefs(&dir, "local", "main").is_empty());
        let raw: serde_json::Value =
            serde_json::from_slice(&fs::read(prefs_file_path(&dir)).unwrap()).unwrap();
        assert!(!raw["preferences"]
            .as_object()
            .unwrap()
            .contains_key("local:main"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefs_reject_invalid_input_and_caps() {
        let dir = unique_temp_dir("prefs-invalid");
        // Bad scope ids.
        assert!(!write_prefs(&dir, "", "main", "k", "v"));
        assert!(!write_prefs(&dir, "local", "has\u{0}control", "k", "v"));
        assert!(read_prefs(&dir, "", "main").is_empty());
        // Bad keys / values.
        assert!(!write_prefs(&dir, "local", "main", "", "v"));
        assert!(!write_prefs(
            &dir,
            "local",
            "main",
            &"k".repeat(200),
            "v"
        ));
        assert!(!write_prefs(
            &dir,
            "local",
            "main",
            "k",
            &"v".repeat(300 * 1024)
        ));
        assert!(!remove_prefs(&dir, "local", "main", ""));
        assert!(read_prefs(&dir, "local", "main").is_empty());
        // Removing an absent key is a no-op success like the TS store.
        assert!(write_prefs(&dir, "local", "main", "k", "v"));
        assert!(remove_prefs(&dir, "local", "main", "missing"));
        assert_eq!(read_prefs(&dir, "local", "main").len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn uri_component_codec_round_trips() {
        assert_eq!(encode_uri_component("local:main"), "local%3Amain");
        assert_eq!(encode_uri_component("a b/c~d"), "a%20b%2Fc~d");
        for value in ["local", "pro/file", "win dow", "100%", "ünï"] {
            assert_eq!(
            decode_uri_component(&encode_uri_component(value)).as_deref(),
            Some(value)
            );
        }
        assert_eq!(decode_uri_component("a+b"), Some("a+b".to_owned()));
        assert_eq!(decode_uri_component("%zz"), None);
        assert_eq!(decode_uri_component("%"), None);
    }
}
