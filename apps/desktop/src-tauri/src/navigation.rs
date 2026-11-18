//! Route reporting, external navigation gating, and deep-link forwarding.
//!
//! The frontend reports hash changes through `route_changed` (Electrobun RPC
//! message parity); each report is persisted as the window's last route and
//! the first one hands the splash over to the main window.
//!
//! Navigation policy ports `apps/desktop/src/externalNavigation.ts`
//! (`windowNavigationRules`) and `apps/desktop/src/deepLink.ts`
//! (`parseThinkRailDeepLink`). [`allow_navigation`] is attached to the main
//! window: the webview only ever loads the sidecar origin, and anything else
//! goes through `open_external`, which itself only opens `http(s)`/`mailto`
//! URLs in the system browser.
//!
//! `thinkrail://` links are buffered until the page says it can receive them
//! (`deep_link_ready`, sent by the bridge once its `openFile` listener is
//! registered) and again whenever the document is replaced.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Mirror of `WORKSPACE_VIEW_ROUTE` in `@thinkrail/contracts` (`domain.ts`):
/// same-origin navigations under this route are served externally (opened in
/// the browser via `externalNavigationUrl`), so the in-webview allowlist
/// re-blocks them.
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

/// Deep links waiting for a page that can receive them.
///
/// `ready` and `pending` share one lock on purpose. With a separate flag, a
/// link could read "not ready", lose the CPU while the page reported ready and
/// drained the queue, then queue itself with no later signal to deliver it.
#[derive(Default)]
struct DeepLinkQueue {
    /// Whether the current document holds an `openFile` listener.
    ready: bool,
    pending: Vec<DeepLinkTarget>,
}

impl DeepLinkQueue {
    /// Deliver `target` now if the page is listening and `emit` succeeds;
    /// otherwise keep it for the next ready signal. Returns whether it was
    /// delivered.
    fn offer(&mut self, target: DeepLinkTarget, emit: impl FnOnce(&DeepLinkTarget) -> bool) -> bool {
        if self.ready && emit(&target) {
            return true;
        }
        self.pending.push(target);
        false
    }

    /// Mark the page ready and deliver every buffered link in arrival order.
    /// A link whose `emit` fails stays buffered, and only that link: the ones
    /// that were delivered must not be sent twice. Returns how many went out.
    fn drain(&mut self, mut emit: impl FnMut(&DeepLinkTarget) -> bool) -> usize {
        self.ready = true;
        let before = self.pending.len();
        self.pending.retain(|target| !emit(target));
        before - self.pending.len()
    }

    /// The document is being replaced: its listener is gone until the new
    /// one reports ready.
    fn reset(&mut self) {
        self.ready = false;
    }
}

static DEEP_LINKS: Mutex<DeepLinkQueue> = Mutex::new(DeepLinkQueue {
    ready: false,
    pending: Vec::new(),
});

/// Port of `windowNavigationRules` in `externalNavigation.ts`: block
/// everything by default; allow same-origin navigations (`origin` and
/// `origin/*`), `about:srcdoc`, and `blob:origin/*`; then re-block
/// `origin + WORKSPACE_VIEW_ROUTE` (those open externally instead).
///
/// This is the in-webview allowlist. Cross-origin `http(s)`/`mailto` URLs are
/// intentionally rejected here: they never navigate the webview and are
/// opened in the system browser through [`open_external`] instead.
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
    if url.is_empty() || utf16_len(url) > MAX_DEEP_LINK_LENGTH {
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

/// Length in UTF-16 code units, matching the `string.length` caps in
/// `deepLink.ts` (a byte count would reject valid non-ASCII paths early).
fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
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
        || utf16_len(file) > MAX_DEEP_LINK_PATH_LENGTH
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

/// Send one link to the page, bringing the window forward first like
/// `revealDeepLink` in `index.ts`.
fn emit_open_file(app: &AppHandle, target: &DeepLinkTarget) -> bool {
    if let Some(main) = app.get_webview_window("main") {
        if main.is_minimized().unwrap_or(false) {
            let _ = main.unminimize();
        }
        let _ = main.show();
        let _ = main.set_focus();
    }
    app.emit("openFile", target).is_ok()
}

/// Forward a `thinkrail://` URL as an `openFile` event. Links that arrive
/// while no page is listening (single-instance second launches, the OS
/// handler at startup, a reload) are buffered until [`deep_link_ready`].
pub fn forward_deep_link(app: &AppHandle, url: &str) -> Result<(), String> {
    let target =
        parse_thinkrail_deep_link(url).ok_or_else(|| "invalid thinkrail:// deep link".to_owned())?;
    DEEP_LINKS
        .lock()
        .map_err(|error| error.to_string())?
        .offer(target, |target| emit_open_file(app, target));
    Ok(())
}

/// The main window started loading a document: whatever listened before is
/// gone, so links buffer again until the new page reports ready.
pub fn page_load_started() {
    if let Ok(mut queue) = DEEP_LINKS.lock() {
        queue.reset();
    }
}

#[tauri::command]
pub fn route_changed(app: AppHandle, hash: String) -> Result<(), String> {
    if !crate::lifecycle::is_neutral_e2e_host() {
        crate::state::save_route(&app, &hash);
    }
    // The first report means the web UI is running: hand the splash over.
    crate::window::reveal_main_window(&app);
    Ok(())
}

/// The page holds its `openFile` listener: deliver buffered links and send
/// later ones straight through. Returns how many were delivered.
#[tauri::command]
pub fn deep_link_ready(app: AppHandle) -> Result<usize, String> {
    let mut queue = DEEP_LINKS.lock().map_err(|error| error.to_string())?;
    Ok(queue.drain(|target| emit_open_file(&app, target)))
}

/// Navigation policy for the main window, the Tauri analogue of
/// `setNavigationRules(windowNavigationRules(origin))` plus
/// `installExternalNavigation`: the webview may only load the sidecar origin
/// (and its `srcdoc`/`blob:` frames). Every other destination is refused, and
/// the ones a person may follow (`http(s)`, `mailto`, the sidecar's own
/// `/view/` pages) open in the system browser instead.
pub fn allow_navigation(app: &AppHandle, url: &url::Url, origin: &str) -> bool {
    if is_external_navigation_allowed(url.as_str(), origin) {
        return true;
    }
    // In-app thinkrail:// links never load in the webview: route them to the
    // same `openFile` path as OS-delivered links.
    if url.scheme() == "thinkrail" {
        if let Err(error) = forward_deep_link(app, url.as_str()) {
            eprintln!("[desktop] ignoring invalid deep link: {error}");
        }
        return false;
    }
    if let Err(error) = open_external(app, url.as_str()) {
        eprintln!("[desktop] {error}");
    }
    false
}

/// Whether a `window.open` / `_blank` / modifier-click request may leave the
/// app. Port of `externalNavigationUrl` for the `new-window-open` event: a
/// same-origin request is the app's own business (only its `/view/` pages are
/// external by intent), anything else is vetted by [`vetted_external_url`].
fn new_window_leaves_app(url: &str, origin: &str) -> bool {
    let same_origin = url == origin || url.starts_with(&format!("{origin}/"));
    if same_origin {
        return url.starts_with(&format!("{origin}{WORKSPACE_VIEW_ROUTE}"));
    }
    vetted_external_url(url).is_some()
}

/// New-window policy for the main window. The webview never opens a second
/// window: Tauri would give it no bridge and no navigation policy (WebView2
/// opens one by default for Ctrl-click, `window.open` from an iframe and
/// `_blank` forms). Electrobun reports these as `new-window-open` and opens
/// the allowlisted ones in the system browser; this does the same.
pub fn handle_new_window(app: &AppHandle, url: &url::Url, origin: &str) {
    if url.scheme() == "thinkrail" {
        if let Err(error) = forward_deep_link(app, url.as_str()) {
            eprintln!("[desktop] ignoring invalid deep link: {error}");
        }
        return;
    }
    if !new_window_leaves_app(url.as_str(), origin) {
        return;
    }
    if let Err(error) = open_external(app, url.as_str()) {
        eprintln!("[desktop] {error}");
    }
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

/// Open an external URL in the system browser. Enforces the allowlist itself
/// and returns `Err` on blocked URLs instead of handing them to the OS.
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
    fn new_windows_only_leave_the_app_through_the_allowlist() {
        // Outside links open in the browser.
        assert!(new_window_leaves_app("https://example.com/docs", ORIGIN));
        assert!(new_window_leaves_app("mailto:team@example.com", ORIGIN));
        // The host's workspace file view is external by intent.
        assert!(new_window_leaves_app("https://app.example/view/abc", ORIGIN));
        // The app's own pages never get a second window or a browser tab.
        assert!(!new_window_leaves_app("https://app.example/#/v1/chat", ORIGIN));
        assert!(!new_window_leaves_app("https://app.example", ORIGIN));
        // Other schemes never reach the OS.
        assert!(!new_window_leaves_app("file:///etc/passwd", ORIGIN));
        assert!(!new_window_leaves_app("javascript:alert(1)", ORIGIN));
        assert!(!new_window_leaves_app("about:blank", ORIGIN));
    }

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
    fn buffers_links_until_the_page_is_ready() {
        let mut queue = DeepLinkQueue::default();
        let mut sent = Vec::new();
        assert!(!queue.offer(deep_link("/a", 1, None), |_| panic!("not ready yet")));
        assert!(!queue.offer(deep_link("/b", 1, None), |_| panic!("not ready yet")));
        assert_eq!(
            queue.drain(|target| {
                sent.push(target.file.clone());
                true
            }),
            2
        );
        assert_eq!(sent, ["/a", "/b"]);
        // Once ready, links go straight through.
        assert!(queue.offer(deep_link("/c", 1, None), |_| true));
        assert!(queue.pending.is_empty());
    }

    #[test]
    fn keeps_only_the_links_that_failed_to_send() {
        let mut queue = DeepLinkQueue::default();
        for file in ["/a", "/b", "/c"] {
            queue.offer(deep_link(file, 1, None), |_| true);
        }
        // `/a` fails and `/b`, `/c` succeed: only `/a` may be retried.
        assert_eq!(queue.drain(|target| target.file != "/a"), 2);
        assert_eq!(queue.pending, [deep_link("/a", 1, None)]);
        let mut retried = Vec::new();
        assert_eq!(
            queue.drain(|target| {
                retried.push(target.file.clone());
                true
            }),
            1
        );
        assert_eq!(retried, ["/a"]);
        // A ready page whose send fails keeps the link too.
        assert!(!queue.offer(deep_link("/d", 1, None), |_| false));
        assert_eq!(queue.pending, [deep_link("/d", 1, None)]);
    }

    #[test]
    fn buffers_again_while_the_document_is_replaced() {
        let mut queue = DeepLinkQueue::default();
        assert_eq!(queue.drain(|_| true), 0);
        queue.reset();
        assert!(!queue.offer(deep_link("/a", 1, None), |_| panic!("page is reloading")));
        assert_eq!(queue.drain(|_| true), 1);
    }

    #[test]
    fn measures_deep_link_paths_in_utf16_units() {
        // 2000 CJK characters are 6000 UTF-8 bytes but 2000 UTF-16 units:
        // inside the 4096 path cap, like `file.length` in `deepLink.ts`.
        let path = format!("/{}", "文".repeat(2000));
        assert!(is_acceptable_path(&path));
        assert!(!is_acceptable_path(&format!("/{}", "文".repeat(4096))));
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
