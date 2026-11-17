//! Native window policy, splash screen, page zoom, and state publishing.
//!
//! Mirrors the Electrobun main-process policy (`apps/desktop/src/index.ts`
//! with `desktopWindowChrome()`): macOS overlays the traffic lights over the
//! content, Windows goes borderless with the system frame controls restored
//! (so the web-drawn min/max/close buttons hit-test), Linux keeps normal
//! decorations. Geometry and window-state changes are published to the web
//! client as `windowChromeChanged` / `windowStateChanged` events.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl, Window};

pub const MAIN_WINDOW: &str = "main";
pub const SPLASH_WINDOW: &str = "splash";
/// Main window size, mirroring `frame` in `apps/desktop/src/index.ts`.
const MAIN_WIDTH: f64 = 1440.0;
const MAIN_HEIGHT: f64 = 920.0;
/// Splash window geometry, mirroring `SPLASH_SIZE` in `splash.ts`.
const SPLASH_WIDTH: f64 = 360.0;
const SPLASH_HEIGHT: f64 = 200.0;

/// `NativeWindowState` as the web `useNativeWindowControls` guard expects it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWindowState {
    pub maximized: bool,
    pub full_screen: bool,
}

/// `WindowChromeGeometry` as the preload style writer expects it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowChromeGeometry {
    pub inset_left: u32,
    pub inset_right: u32,
}

/// Per-OS content insets, mirroring `desktopWindowChrome()`.
fn platform_insets() -> (u32, u32) {
    #[cfg(target_os = "macos")]
    {
        (64, 0)
    }
    #[cfg(windows)]
    {
        (0, 138)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        (0, 0)
    }
}

/// `WindowChromePreloadSeed` as the bridge reads it before first paint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowChromeSeed {
    pub inset_left: u32,
    pub inset_right: u32,
    pub drag_region: bool,
    pub window_controls: bool,
}

/// Port of `windowChromePreloadSeed(desktopWindowChrome(platform))`: macOS
/// and Windows draw their own title bar (a drag region the web marks up),
/// and only Windows needs the web-drawn minimize/maximize/close buttons.
pub fn window_chrome_seed() -> WindowChromeSeed {
    let (inset_left, inset_right) = platform_insets();
    WindowChromeSeed {
        inset_left,
        inset_right,
        drag_region: cfg!(any(target_os = "macos", windows)),
        window_controls: cfg!(windows),
    }
}

pub fn window_chrome_geometry(full_screen: bool) -> WindowChromeGeometry {
    let (inset_left, inset_right) = if full_screen {
        (0, 0)
    } else {
        platform_insets()
    };
    WindowChromeGeometry {
        inset_left,
        inset_right,
    }
}

/// Apply the per-OS window policy to the main window.
pub fn configure_main_window(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        // Overlay draws the traffic lights over the content like Electrobun's
        // hiddenInset style; the topbar reserves the inset through CSS.
        // TODO: restore the (0, 4) traffic-light offset when Tauri exposes
        // `set_traffic_light_position` on stable.
        if let Err(error) = window.set_title_bar_style(tauri::TitleBarStyle::Overlay) {
            eprintln!("[desktop] could not set the overlay title bar style: {error}");
        }
    }
    #[cfg(windows)]
    {
        // Borderless like Electrobun, then restore the system frame controls
        // (minimize/maximize/close hit-testing) that the web draws itself.
        if let Err(error) = window.set_decorations(false) {
            eprintln!("[desktop] could not remove window decorations: {error}");
        }
        restore_windows_frame_controls(window);
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        if let Err(error) = window.set_decorations(true) {
            eprintln!("[desktop] could not set window decorations: {error}");
        }
    }
}

/// Windows-only: OR `WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX` back into
/// the borderless window style and refresh the frame. Ports
/// `restoreWindowsFrameControls` from `windowsFrame.ts`.
#[cfg(windows)]
fn restore_windows_frame_controls(window: &WebviewWindow) {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        },
    };

    // Mirror windowsFrame.ts: GWL_STYLE slot plus the three control bits.
    const WS_SYSMENU: isize = 0x0008_0000;
    const WS_MINIMIZEBOX: isize = 0x0002_0000;
    const WS_MAXIMIZEBOX: isize = 0x0001_0000;
    const FRAME_CONTROLS: isize = WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

    // `Window::hwnd` returns Tauri's own `windows`-crate HWND; round-trip
    // through the raw value so this module never depends on Tauri's exact
    // `windows` version.
    let hwnd = match window.hwnd() {
        Ok(hwnd) => HWND(hwnd.0),
        Err(error) => {
            eprintln!("[desktop] could not get the window handle: {error}");
            return;
        }
    };
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let next = style | FRAME_CONTROLS;
        if next == style {
            return;
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, next);
        if GetWindowLongPtrW(hwnd, GWL_STYLE) & FRAME_CONTROLS != FRAME_CONTROLS {
            eprintln!("[desktop] could not update the Windows window style");
            return;
        }
        if SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .is_err()
        {
            eprintln!("[desktop] could not refresh the Windows window frame");
        }
    }
}

fn read_state(window: &Window) -> NativeWindowState {
    NativeWindowState {
        maximized: window.is_maximized().unwrap_or(false),
        full_screen: window.is_fullscreen().unwrap_or(false),
    }
}

fn toggle_maximize(window: &Window) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

/// Publish the current maximized/fullscreen state (Electrobun `windowStateChanged`).
pub fn publish_window_state(window: &Window) {
    let _ = window.emit("windowStateChanged", read_state(window));
}

/// Publish the current content insets (Electrobun `windowChromeChanged`).
pub fn publish_window_chrome(window: &Window) {
    let full_screen = window.is_fullscreen().unwrap_or(false);
    let _ = window.emit("windowChromeChanged", window_chrome_geometry(full_screen));
}

#[tauri::command]
pub fn get_window_state(window: Window) -> NativeWindowState {
    read_state(&window)
}

#[tauri::command]
pub fn minimize_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn toggle_maximize_window(window: Window) -> Result<(), String> {
    toggle_maximize(&window)
}

#[tauri::command]
pub fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

/// A primary press on the web-drawn title bar: start a native window move.
/// Tauri has no CSS drag-region hook, so the bridge reports the press.
#[tauri::command]
pub fn start_window_drag(window: Window) -> Result<(), String> {
    if window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }
    window.start_dragging().map_err(|error| error.to_string())
}

/// What a title-bar double-click does (`TitleBarDoubleClickAction`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TitleBarAction {
    Zoom,
    Minimize,
    Nothing,
}

/// Port of `titleBarDoubleClickAction`: the macOS "Double-click a window's
/// title bar to" setting. Unset means the system default, zoom.
fn title_bar_action(preference: Option<&str>) -> TitleBarAction {
    match preference {
        None | Some("Maximize" | "Fill") => TitleBarAction::Zoom,
        Some("Minimize") => TitleBarAction::Minimize,
        Some(_) => TitleBarAction::Nothing,
    }
}

/// Port of `readTitleBarDoubleClickPreference`: the global
/// `AppleActionOnDoubleClick` default, or `None` when it is unset.
#[cfg(target_os = "macos")]
fn title_bar_preference() -> Option<String> {
    let output = std::process::Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleActionOnDoubleClick"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let preference = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!preference.is_empty()).then_some(preference)
}

/// Only macOS has the setting; elsewhere a double-click on the title bar
/// maximizes, as the native frame would.
#[cfg(not(target_os = "macos"))]
fn title_bar_preference() -> Option<String> {
    None
}

#[tauri::command]
pub fn title_bar_double_click(window: Window) -> Result<(), String> {
    if window.is_fullscreen().map_err(|error| error.to_string())? {
        return Ok(());
    }
    match title_bar_action(title_bar_preference().as_deref()) {
        TitleBarAction::Zoom => toggle_maximize(&window),
        TitleBarAction::Minimize => window.minimize().map_err(|error| error.to_string()),
        TitleBarAction::Nothing => Ok(()),
    }
}

// Page zoom steps, mirroring `PAGE_ZOOM_FACTORS` in `pageZoom.ts`.
const PAGE_ZOOM_MIN: f64 = 0.5;
const PAGE_ZOOM_MAX: f64 = 2.0;
const PAGE_ZOOM_FACTORS: [f64; 10] = [0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
const PAGE_ZOOM_TOLERANCE: f64 = 0.001;

/// Page zoom of the main window, plus the zoom a pinch started from.
struct PageZoom {
    current: f64,
    gesture_start: Option<f64>,
}

static PAGE_ZOOM: Mutex<PageZoom> = Mutex::new(PageZoom {
    current: 1.0,
    gesture_start: None,
});

/// Port of `createPageZoomGestureHandler`: a pinch reports its scale relative
/// to where the gesture began, so every change is applied to the zoom
/// captured at `start`, never to the previous change. Returns the zoom to
/// apply, if any.
fn apply_zoom_gesture(zoom: &mut PageZoom, phase: &str, scale: Option<f64>) -> Option<f64> {
    match phase {
        "start" => zoom.gesture_start = Some(zoom.current),
        "end" => zoom.gesture_start = None,
        "change" => {
            let (start, scale) = (zoom.gesture_start?, scale?);
            if !scale.is_finite() || scale <= 0.0 {
                return None;
            }
            zoom.current = (start * scale).clamp(PAGE_ZOOM_MIN, PAGE_ZOOM_MAX);
            return Some(zoom.current);
        }
        _ => {}
    }
    None
}

fn next_page_zoom(current: f64, action: &str) -> f64 {
    match action {
        "reset" => 1.0,
        "in" => PAGE_ZOOM_FACTORS
            .iter()
            .copied()
            .find(|factor| *factor > current + PAGE_ZOOM_TOLERANCE)
            .unwrap_or(current),
        "out" => PAGE_ZOOM_FACTORS
            .iter()
            .copied()
            .rev()
            .find(|factor| *factor < current - PAGE_ZOOM_TOLERANCE)
            .unwrap_or(current),
        _ => current,
    }
}

#[tauri::command]
pub fn page_zoom_requested(window: WebviewWindow, action: String) -> Result<(), String> {
    let mut zoom = PAGE_ZOOM.lock().map_err(|error| error.to_string())?;
    zoom.current = next_page_zoom(zoom.current, &action);
    window
        .set_zoom(zoom.current)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn page_zoom_gesture_requested(
    window: WebviewWindow,
    phase: String,
    scale: Option<f64>,
) -> Result<(), String> {
    let mut zoom = PAGE_ZOOM.lock().map_err(|error| error.to_string())?;
    match apply_zoom_gesture(&mut zoom, &phase, scale) {
        Some(next) => window.set_zoom(next).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Splash document, mirroring `splashDocument` in `splash.ts`.
pub fn splash_html(message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
        <meta name=\"color-scheme\" content=\"dark light\"><title>Helios Agent IDE</title>\
        <style>:root{{--bg:#060a12;--fg:#e6f0ff;--muted:#94a8cc;--accent:#00d4ff;--track:#1b2a4a}}\
        @media (prefers-color-scheme: light){{:root{{--bg:#ffffff;--fg:#27272a;--muted:#52525b;--accent:#2563eb;--track:#e4e4e7}}}}\
        html,body{{margin:0;height:100%;background:var(--bg);color:var(--fg);cursor:default;user-select:none;-webkit-user-select:none}}\
        body{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:13px/1.4 system-ui,\"Segoe UI\",sans-serif}}\
        .mark{{font-size:28px;font-weight:700;color:var(--accent)}}\
        .message{{color:var(--muted)}}\
        .bar{{width:220px;height:3px;border-radius:2px;background:var(--track);overflow:hidden}}\
        .bar i{{display:block;width:35%;height:100%;border-radius:2px;background:var(--accent);animation:slide 1.2s ease-in-out infinite}}\
        @keyframes slide{{from{{transform:translateX(-100%)}}to{{transform:translateX(290%)}}}}\
        @media (prefers-reduced-motion: reduce){{.bar i{{animation:none;width:100%;opacity:.5}}}}\
        </style></head><body><div class=\"mark\">Helios</div>\
        <div class=\"message\" role=\"status\">{}</div><div class=\"bar\"><i></i></div></body></html>",
        escape_html(message)
    )
}

fn percent_encode_segment(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Open the small centered splash window. It covers startup until
/// [`reveal_main_window`] hands over, mirroring `handOffStartupSplash`.
pub fn open_splash_window(app: &AppHandle, message: &str) -> Result<WebviewWindow, String> {
    let encoded = percent_encode_segment(&splash_html(message));
    let url = url::Url::parse(&format!("data:text/html;charset=utf-8,{encoded}"))
        .map_err(|error| format!("could not build the splash URL: {error}"))?;
    WebviewWindowBuilder::new(app, SPLASH_WINDOW, WebviewUrl::External(url))
        .title("Helios Agent IDE")
        .inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .center()
        .decorations(false)
        .resizable(false)
        .build()
        .map_err(|error| format!("could not open the splash window: {error}"))
}

/// Hide the splash without closing it. Used while a startup error dialog is
/// up: closing the only window would end the app before the dialog is read.
pub fn hide_splash(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = window.hide();
    }
}

/// Whether the startup handoff already ran.
static MAIN_WINDOW_REVEALED: AtomicBool = AtomicBool::new(false);

/// Hand the splash over to the main window: show the main window (unless the
/// shell runs hidden), then close the splash. The main window is created
/// hidden so the splash, not a blank frame, covers the page load. Only the
/// first call does anything, so a later reload or route change never pulls a
/// window the user hid or minimized back to the front.
pub fn reveal_main_window(app: &AppHandle) {
    if MAIN_WINDOW_REVEALED.swap(true, Ordering::SeqCst) {
        return;
    }
    let stays_hidden =
        crate::lifecycle::is_hidden_window() || crate::lifecycle::is_neutral_e2e_host();
    if !stays_hidden {
        if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
    if let Some(splash) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = splash.close();
    }
}

/// Build the main window on `url`, hidden until [`reveal_main_window`].
/// `bridge` is the initialization script and navigation origin for the UI
/// window; the neutral E2E host passes `None` and gets a bare window.
pub fn open_main_window(
    app: &AppHandle,
    url: url::Url,
    bridge: Option<(String, String)>,
) -> Result<WebviewWindow, String> {
    let mut builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::External(url))
        .title("Helios Agent IDE")
        .inner_size(MAIN_WIDTH, MAIN_HEIGHT)
        .visible(false);
    if let Some((script, origin)) = bridge {
        let navigation_app = app.clone();
        builder = builder
            .initialization_script(script)
            .on_navigation(move |url| {
                crate::navigation::allow_navigation(&navigation_app, url, &origin)
            })
            .on_page_load(|window, payload| match payload.event() {
                tauri::webview::PageLoadEvent::Started => crate::navigation::page_load_started(),
                // The dom-ready handoff. The bridge's first route report does
                // the same, so a page that never reports still gets shown.
                tauri::webview::PageLoadEvent::Finished => {
                    reveal_main_window(window.app_handle());
                }
            });
    }
    let window = builder
        .build()
        .map_err(|error| format!("could not open the main window: {error}"))?;
    Ok(window)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splash_styles_apply_in_both_color_schemes() {
        let html = splash_html("Starting Helios…");
        // The light-scheme block closes before the shared layout rules, so
        // dark mode keeps the centering and the progress bar.
        let (light_block, shared) = html
            .split_once("@media (prefers-color-scheme: light){")
            .and_then(|(_, rest)| rest.split_once("html,body{"))
            .expect("light block followed by shared rules");
        assert_eq!(
            light_block.matches('{').count(),
            light_block.matches('}').count() - 1
        );
        assert!(shared.contains(".bar i{"));
        let style = html
            .split_once("<style>")
            .and_then(|(_, rest)| rest.split_once("</style>"))
            .expect("style element")
            .0;
        assert_eq!(style.matches('{').count(), style.matches('}').count());
        assert!(html.contains("Starting Helios…"));
    }

    #[test]
    fn splash_message_is_escaped() {
        assert!(splash_html("<b>&\"").contains("&lt;b&gt;&amp;&quot;"));
    }

    #[test]
    fn pinch_scale_is_relative_to_the_gesture_start() {
        let mut zoom = PageZoom {
            current: 1.0,
            gesture_start: None,
        };
        // A change before `start` belongs to no gesture.
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(1.5)), None);
        assert_eq!(apply_zoom_gesture(&mut zoom, "start", None), None);
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(1.1)), Some(1.1));
        // 1.2 is the whole gesture so far, not 1.2 on top of 1.1.
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(1.2)), Some(1.2));
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(9.0)), Some(PAGE_ZOOM_MAX));
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(f64::NAN)), None);
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(0.0)), None);
        assert_eq!(apply_zoom_gesture(&mut zoom, "end", None), None);
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(0.5)), None);
        // The next pinch starts from where the last one ended.
        apply_zoom_gesture(&mut zoom, "start", None);
        assert_eq!(apply_zoom_gesture(&mut zoom, "change", Some(0.5)), Some(1.0));
    }

    #[test]
    fn title_bar_double_click_follows_the_macos_setting() {
        assert_eq!(title_bar_action(None), TitleBarAction::Zoom);
        assert_eq!(title_bar_action(Some("Maximize")), TitleBarAction::Zoom);
        assert_eq!(title_bar_action(Some("Fill")), TitleBarAction::Zoom);
        assert_eq!(title_bar_action(Some("Minimize")), TitleBarAction::Minimize);
        assert_eq!(title_bar_action(Some("None")), TitleBarAction::Nothing);
    }

    #[test]
    fn page_zoom_steps_through_the_factor_table() {
        assert_eq!(next_page_zoom(1.0, "in"), 1.1);
        assert_eq!(next_page_zoom(1.0, "out"), 0.9);
        assert_eq!(next_page_zoom(1.6, "reset"), 1.0);
        assert_eq!(next_page_zoom(PAGE_ZOOM_MAX, "in"), PAGE_ZOOM_MAX);
        assert_eq!(next_page_zoom(PAGE_ZOOM_MIN, "out"), PAGE_ZOOM_MIN);
    }
}
