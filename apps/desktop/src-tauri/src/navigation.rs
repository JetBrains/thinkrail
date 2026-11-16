//! Route reporting, external navigation gating, and deep-link forwarding.
//!
//! The frontend reports hash changes through `route_changed` (Electrobun RPC
//! message parity). The first report also retires the splash window, which is
//! the Tauri analogue of the Electrobun dom-ready handoff, and flushes any
//! `thinkrail://` links that arrived before the web UI was ready.
//!
//! Navigation policy ports `apps/desktop/src/externalNavigation.ts`
//! (`windowNavigationRules`) and `apps/desktop/src/deepLink.ts`
//! (`parseThinkRailDeepLink`). Anything the allowlist rejects must go through
//! `open_external`, which itself only opens `http(s)`/`mailto` URLs in the
//! system browser.

use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::window::close_splash;

/// Mirror of `WORKSPACE_VIEW_ROUTE` in `@thinkrail/contracts` (`domain.ts`):
/// same-origin navigations under this route are served externally (opened in
/// the browser via `externalNavigationUrl`), so the in-webview allowlist
/// re-blocks them.
/// Re-exported for navigation-rule consumers; no in-crate caller yet.
#[allow(dead_code)]
pub const WORKSPACE_VIEW_ROUTE: &str = "/view/";

/// Mirror of `MAX_NAVIGATION_DETAIL_LENGTH` in `externalNavigation.ts`.
const MAX_EXTERNAL_URL_LENGTH: usize = 64 * 1024;

/// Validation caps mirrored from `deepLink.ts`.
const MAX_DEEP_LINK_LENGTH: usize = 8 * 1024;
const MAX_DEEP_LINK_PATH_LENGTH: usize = 4_096;
const MAX_DEEP_LINK_POSITION: u32 = 2_000_000;

/// `NativeOpenFileRequest` as the web `openFile` bridge listener expects it
/// (`@thinkrail/contracts`, `nativeClient.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeepLinkTarget {
    pub file: String,
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
}

/// Whether the web UI has reported its first route (the dom-ready handoff).
/// Links that arrive earlier are buffered in [`PENDING_DEEP_LINKS`].
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

/// `thinkrail://` links received before the web UI is ready, drained by
/// [`drain_pending_deep_links`].
static PENDING_DEEP_LINKS: OnceLock<Mutex<Vec<DeepLinkTarget>>> = OnceLock::new();

fn pending_deep_links() -> &'static Mutex<Vec<DeepLinkTarget>> {
    PENDING_DEEP_LINKS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Port of `windowNavigationRules` in `externalNavigation.ts`: block
/// everything by default; allow same-origin navigations (`origin` and
/// `origin/*`), `about:srcdoc`, and `blob:origin/*`; then re-block
/// `origin + WORKSPACE_VIEW_ROUTE` (those open externally instead).
///
/// This is the in-webview allowlist. Cross-origin `http(s)`/`mailto` URLs are
/// intentionally rejected here: they never navigate the webview and are
/// opened in the system browser through [`open_external`] instead.
#[allow(dead_code)]
pub fn is_external_navigation_allowed(url: &str, origin: &str) -> bool {
    if url.is_empty() || origin.is_empty() {
        return false;
    }
    if url == "about:srcdoc" {
        return true;
    }
    if let Some(rest) = url.strip_prefix("blob:") {
        return rest == origin || rest.starts_with(&format!("{origin}/"));
    }
    let same_origin = url == origin || url.starts_with(&format!("{origin}/"));
    if !same_origin {
        return false;
    }
    // Same-origin `/view/` routes open externally; keep them out of the webview.
    !url.starts_with(&format!("{origin}{WORKSPACE_VIEW_ROUTE}"))
}

/// Port of `parseThinkRailDeepLink` in `deepLink.ts`: only
/// `thinkrail://open?file=<absolute path>&line&column` links validate.
/// Unknown query params are ignored; duplicate or valueless `file`/`line`/
/// `column` params, non-`thinkrail` schemes, non-`open` hosts, userinfo,
/// paths, fragments, overlong input, control characters, relative paths,
/// `..` segments, and out-of-range positions all reject.
pub fn parse_thinkrail_deep_link(url: &str) -> Option<DeepLinkTarget> {
    if url.is_empty() || url.len() > MAX_DEEP_LINK_LENGTH {
        return None;
    }
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "thinkrail" || parsed.host_str() != Some("open") {
        return None;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return None;
    }
    if !matches!(parsed.path(), "" | "/") || parsed.fragment().is_some() {
        return None;
    }

    let mut file: Option<String> = None;
    let mut line: Option<u32> = None;
    let mut column: Option<u32> = None;
    let mut seen = [false; 3];
    for pair in parsed.query().unwrap_or("").split('&') {
        let (name, raw) = match pair.split_once('=') {
            Some((name, value)) => (name, value),
            // Mirrors `queryParams`: unknown params without `=` are ignored,
            // known ones invalidate the link.
            None if matches!(pair, "file" | "line" | "column") => return None,
            None => continue,
        };
        let slot = match name {
            "file" => 0,
            "line" => 1,
            "column" => 2,
            // Unknown params are ignored, like `queryParams`.
            _ => continue,
        };
        if seen[slot] {
            return None;
        }
        seen[slot] = true;
        // `decodeURIComponent` semantics: `%XX` decoding, `+` stays literal,
        // malformed sequences fail the whole link.
        let value = decode_query_value(raw)?;
        match name {
            "file" => {
                if !is_acceptable_path(&value) {
                    return None;
                }
                file = Some(value);
            }
            "line" => line = Some(positive_integer(&value)?),
            _ => column = Some(positive_integer(&value)?),
        }
    }

    Some(DeepLinkTarget {
        file: file.filter(|file| !file.is_empty())?,
        line: line.unwrap_or(1),
        column,
    })
}

/// Mirror of `positiveInteger` in `deepLink.ts`: 1-7 ASCII digits and
/// `1..=MAX_DEEP_LINK_POSITION`.
fn positive_integer(value: &str) -> Option<u32> {
    if value.is_empty()
        || value.len() > 7
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let parsed: u32 = value.parse().ok()?;
    (parsed >= 1 && parsed <= MAX_DEEP_LINK_POSITION).then_some(parsed)
}

/// Mirror of `acceptablePath` in `deepLink.ts`: absolute (POSIX or Win32),
/// within the length cap, with no control characters or `..` segments.
fn is_acceptable_path(file: &str) -> bool {
    if file.is_empty()
        || file.len() > MAX_DEEP_LINK_PATH_LENGTH
        || file.chars().any(|char| char.is_control())
    {
        return false;
    }
    if !is_absolute_path(file) {
        return false;
    }
    !file.split(['/', '\\']).any(|segment| segment == "..")
}

/// Mirror of `isAbsolute(file) || win32.isAbsolute(file)`: POSIX roots,
/// drive-letter roots (`C:\` / `C:/`, not drive-relative `C:`), and UNC
/// roots (`\\server\share`).
fn is_absolute_path(file: &str) -> bool {
    if file.starts_with('/') {
        return true;
    }
    let bytes = file.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
    {
        return true;
    }
    file.starts_with("\\\\")
}

/// Percent-decode with `decodeURIComponent` semantics: `+` stays literal and
/// malformed `%` sequences fail instead of producing replacement characters.
fn decode_query_value(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
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

fn emit_open_file(app: &AppHandle, target: &DeepLinkTarget) -> Result<(), String> {
    app.emit("openFile", target).map_err(|error| error.to_string())
}

fn mark_frontend_ready() {
    FRONTEND_READY.store(true, Ordering::SeqCst);
}

/// Forward a `thinkrail://` URL as an `openFile` event. Links that arrive
/// before the web UI is ready (single-instance second launches, OS handler at
/// startup) are buffered until [`drain_pending_deep_links`] runs.
pub fn forward_deep_link(app: &AppHandle, url: &str) -> Result<(), String> {
    let target =
        parse_thinkrail_deep_link(url).ok_or_else(|| "invalid thinkrail:// deep link".to_owned())?;
    if FRONTEND_READY.load(Ordering::SeqCst) {
        emit_open_file(app, &target)?;
    } else {
        pending_deep_links()
            .lock()
            .map_err(|error| error.to_string())?
            .push(target);
    }
    Ok(())
}

/// Emit every buffered deep link as an `openFile` event and return how many
/// were delivered. Links that fail to emit are re-buffered so they are not
/// lost; the next ready signal retries them.
pub fn drain_pending_deep_links(app: &AppHandle) -> usize {
    let targets: Vec<DeepLinkTarget> = pending_deep_links()
        .lock()
        .map(|mut guard| std::mem::take(&mut *guard))
        .unwrap_or_default();
    let mut delivered = 0;
    for target in &targets {
        if emit_open_file(app, target).is_ok() {
            delivered += 1;
        }
    }
    if delivered < targets.len() {
        if let Ok(mut guard) = pending_deep_links().lock() {
            guard.extend(targets.into_iter().skip(delivered));
        }
    }
    delivered
}

#[tauri::command]
pub fn route_changed(app: AppHandle, hash: String) -> Result<(), String> {
    // TODO: persist the per-window route like `RouteStore` (backend/profile +
    // window identity under the user-data directory).
    let _ = hash;
    close_splash(&app);
    // The first route report is the dom-ready handoff: the web UI can now
    // receive events, so flush any deep links that arrived before it.
    mark_frontend_ready();
    drain_pending_deep_links(&app);
    Ok(())
}

/// Explicit frontend readiness signal (alternative to the first
/// `route_changed` report): mark ready and flush buffered deep links,
/// returning how many were delivered.
#[tauri::command]
pub fn deep_link_ready(app: AppHandle) -> Result<usize, String> {
    mark_frontend_ready();
    Ok(drain_pending_deep_links(&app))
}

/// Cross-origin branch of `externalNavigationUrl` in `externalNavigation.ts`:
/// only bare `http`/`https`/`mailto` URLs may leave the app for the system
/// browser. Same-origin navigations stay in the webview (gated by
/// [`is_external_navigation_allowed`]) and `thinkrail://` links go through
/// [`forward_deep_link`].
fn vetted_external_url(url: &str) -> Option<&str> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_EXTERNAL_URL_LENGTH {
        return None;
    }
    let parsed = url::Url::parse(trimmed).ok()?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => Some(trimmed),
        _ => None,
    }
}

/// Open an already-vetted external URL in the system browser. Unlike the
/// previous TODO, this enforces the navigation allowlist and returns `Err`
/// on blocked URLs instead of handing them to the OS.
#[allow(dead_code)]
pub fn open_external(app: &AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let vetted = vetted_external_url(url)
        .ok_or_else(|| "blocked external navigation: URL is not allowlisted".to_owned())?;
    app.opener()
        .open_url(vetted, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "https://app.example";

    #[test]
    fn allows_same_origin_navigation() {
        assert!(is_external_navigation_allowed(ORIGIN, ORIGIN));
        assert!(is_external_navigation_allowed(
            "https://app.example/",
            ORIGIN
        ));
        assert!(is_external_navigation_allowed(
            "https://app.example/assets/app.js",
            ORIGIN
        ));
    }

    #[test]
    fn allows_srcdoc_and_same_origin_blobs() {
        assert!(is_external_navigation_allowed("about:srcdoc", ORIGIN));
        assert!(is_external_navigation_allowed(
            "blob:https://app.example/uuid-here",
            ORIGIN
        ));
    }

    #[test]
    fn reblocks_workspace_view_route() {
        assert!(!is_external_navigation_allowed(
            "https://app.example/view/workspace",
            ORIGIN
        ));
        assert!(!is_external_navigation_allowed(
            "https://app.example/view/",
            ORIGIN
        ));
    }

    #[test]
    fn blocks_everything_else_by_default() {
        // Cross-origin and lookalike origins never navigate the webview.
        assert!(!is_external_navigation_allowed(
            "https://evil.example/",
            ORIGIN
        ));
        assert!(!is_external_navigation_allowed(
            "https://app.example.evil.example/",
            ORIGIN
        ));
        // Prefix-similar paths outside `/view/` stay allowed.
        assert!(is_external_navigation_allowed(
            "https://app.example/viewer/help",
            ORIGIN
        ));
        // Blob/srcdoc lookalikes from other origins.
        assert!(!is_external_navigation_allowed(
            "blob:https://evil.example/uuid",
            ORIGIN
        ));
        assert!(!is_external_navigation_allowed("about:blank", ORIGIN));
        assert!(!is_external_navigation_allowed(
            "javascript:alert(1)",
            ORIGIN
        ));
        assert!(!is_external_navigation_allowed("", ORIGIN));
        assert!(!is_external_navigation_allowed(ORIGIN, ""));
        assert!(!is_external_navigation_allowed("", ""));
    }

    fn deep_link(file: &str, line: u32, column: Option<u32>) -> DeepLinkTarget {
        DeepLinkTarget {
            file: file.to_owned(),
            line,
            column,
        }
    }

    #[test]
    fn parses_valid_deep_links() {
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=%2Ftmp%2Fnotes.md&line=3&column=5"),
            Some(deep_link("/tmp/notes.md", 3, Some(5)))
        );
        // `line` defaults to 1 and `column` stays absent.
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/tmp/notes.md"),
            Some(deep_link("/tmp/notes.md", 1, None))
        );
        // Trailing slash path and unknown params are tolerated.
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open/?file=/a&extra=1"),
            Some(deep_link("/a", 1, None))
        );
        // Win32 absolute paths validate.
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=C%3A%5Cwork%5Cnotes.md&line=12"),
            Some(deep_link("C:\\work\\notes.md", 12, None))
        );
        // `+` stays literal like `decodeURIComponent`.
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a+b"),
            Some(deep_link("/a+b", 1, None))
        );
    }

    #[test]
    fn rejects_invalid_deep_links() {
        // Scheme / host / userinfo / path / fragment validation.
        assert_eq!(parse_thinkrail_deep_link("https://open?file=/a"), None);
        assert_eq!(parse_thinkrail_deep_link("thinkrail://other?file=/a"), None);
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://user@open?file=/a"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open/x?file=/a"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a#frag"),
            None
        );
        // Missing, duplicate, or valueless params.
        assert_eq!(parse_thinkrail_deep_link("thinkrail://open"), None);
        assert_eq!(parse_thinkrail_deep_link("thinkrail://open?line=2"), None);
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a&file=/b"),
            None
        );
        assert_eq!(parse_thinkrail_deep_link("thinkrail://open?file"), None);
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=%zz"),
            None
        );
        // Path validation: relative, `..`, controls, overlong.
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=rel/path.md"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a/../b"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a%00b"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link(&format!(
                "thinkrail://open?file=/{}",
                "a".repeat(5000)
            )),
            None
        );
        // Position validation.
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a&line=0"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a&line=2000001"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a&line=abc"),
            None
        );
        assert_eq!(
            parse_thinkrail_deep_link("thinkrail://open?file=/a&column=0"),
            None
        );
        // Empty and overlong input.
        assert_eq!(parse_thinkrail_deep_link(""), None);
        assert_eq!(
            parse_thinkrail_deep_link(&format!(
                "thinkrail://open?file=/{}",
                "a".repeat(9000)
            )),
            None
        );
    }
}
