//! Native window policy, splash screen, page zoom, and state publishing.
//!
//! Mirrors the Electrobun main-process policy (`apps/desktop/src/index.ts`
//! with `desktopWindowChrome()`): macOS overlays the traffic lights over the
//! content, Windows goes borderless with the system frame controls restored
//! (so the web-drawn min/max/close buttons hit-test), Linux keeps normal
//! decorations. Geometry and window-state changes are published to the web
//! client as `windowChromeChanged` / `windowStateChanged` events.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl, Window};

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

#[tauri::command]
pub fn title_bar_double_click(window: Window) -> Result<(), String> {
    // TODO: read the macOS AppleActionOnDoubleClick default like
    // `readTitleBarDoubleClickPreference` (zoom vs minimize vs none); the
    // default zoom matches Windows and most macOS configurations.
    if window.is_fullscreen().map_err(|error| error.to_string())? {
        return Ok(());
    }
    toggle_maximize(&window)
}

// Page zoom steps, mirroring `PAGE_ZOOM_FACTORS` in `pageZoom.ts`.
const PAGE_ZOOM_MIN: f64 = 0.5;
const PAGE_ZOOM_MAX: f64 = 2.0;
const PAGE_ZOOM_FACTORS: [f64; 10] = [0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
const PAGE_ZOOM_TOLERANCE: f64 = 0.001;

static PAGE_ZOOM: Mutex<f64> = Mutex::new(1.0);

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
    *zoom = next_page_zoom(*zoom, &action);
    window.set_zoom(*zoom).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn page_zoom_gesture_requested(
    window: WebviewWindow,
    phase: String,
    scale: Option<f64>,
) -> Result<(), String> {
    // TODO: track the gesture-start zoom per window like
    // `createPageZoomGestureHandler` (gesture scale is relative to the zoom
    // when the pinch started, not to the current zoom).
    if phase == "change" {
        if let Some(scale) = scale {
            if scale.is_finite() && scale > 0.0 {
                let mut zoom = PAGE_ZOOM.lock().map_err(|error| error.to_string())?;
                *zoom = (*zoom * scale).clamp(PAGE_ZOOM_MIN, PAGE_ZOOM_MAX);
                window.set_zoom(*zoom).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
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
        <meta name=\"color-scheme\" content=\"dark light\"><title>ThinkRail</title>\
        <style>:root{{--bg:#09090b;--fg:#f4f4f5;--muted:#babac1;--accent:#8dff4f;--track:#27272a}}\
        @media (prefers-color-scheme: light){{:root{{--bg:#ffffff;--fg:#27272a;--muted:#52525b;--accent:#2a7314;--track:#e4e4e7}}\
        html,body{{margin:0;height:100%;background:var(--bg);color:var(--fg);cursor:default;user-select:none;-webkit-user-select:none}}\
        body{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:13px/1.4 system-ui,\"Segoe UI\",sans-serif}}\
        .mark{{font-size:28px;font-weight:700;color:var(--accent)}}\
        .message{{color:var(--muted)}}\
        .bar{{width:220px;height:3px;border-radius:2px;background:var(--track);overflow:hidden}}\
        .bar i{{display:block;width:35%;height:100%;border-radius:2px;background:var(--accent);animation:slide 1.2s ease-in-out infinite}}\
        @keyframes slide{{from{{transform:translateX(-100%)}}to{{transform:translateX(290%)}}}}\
        @media (prefers-reduced-motion: reduce){{.bar i{{animation:none;width:100%;opacity:.5}}}}\
        </style></head><body><div class=\"mark\">ThinkRail</div>\
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

/// Open the small centered splash window. It is closed by the first
/// `route_changed` report (see `navigation.rs`), mirroring the Electrobun
/// dom-ready handoff in `handOffStartupSplash`.
pub fn open_splash_window(app: &AppHandle, message: &str) -> Result<WebviewWindow, String> {
    let encoded = percent_encode_segment(&splash_html(message));
    let url = url::Url::parse(&format!("data:text/html;charset=utf-8,{encoded}"))
        .map_err(|error| format!("could not build the splash URL: {error}"))?;
    WebviewWindowBuilder::new(app, "splash", WebviewUrl::External(url))
        .title("ThinkRail")
        .inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .center()
        .decorations(false)
        .build()
        .map_err(|error| format!("could not open the splash window: {error}"))
}

/// Close the splash window if it is still open (no-op otherwise).
pub fn close_splash(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("splash") {
        let _ = window.close();
    }
}
