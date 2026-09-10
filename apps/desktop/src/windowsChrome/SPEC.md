---
id: submodule-desktop-windows-chrome
type: submodule-design
status: active
title: Bounded Windows native window chrome
parent: module-desktop
references: [module-artifact-tests]
tags: [desktop, windows, window-chrome, public-surface-checked]
---

## Responsibility

A native primitive for the main window's single full-size system webview, not Windows platform activation
or a production-support claim. The public `BrowserWindow.ptr` from Electrobun 2.0.1 supplies the HWND;
no framework internals or additional native input windows participate.

## Boundary

- **Public surface:** `createWindowsChrome`, `WindowsChromeController`, `WindowsChromeAppearance`
- **Allowed deps:** `bun:ffi`, physical staged C source, public Win32/GDI/DWM APIs, and the parent’s pure
  geometry type/validator. The single C file carries the bounded public x64 ABI declarations because Bun's
  compiler has no Windows SDK headers. Parent integration/resource ownership live in [[module-desktop]].
- **Forbidden:** web/server imports, theme identifiers, framework SDK internals/substitute declarations,
  build resolvers, external compiler executables, renderer/window creation, custom caption glyphs, additional
  views/custom region composition, platform selection, native close/destroy, and shutdown ownership.

## Controller and lifetime

`createWindowsChrome(window, sourcePath)` accepts a non-null Bun FFI pointer and is callable only on
`win32-x64`. One lazily compiled `bun:ffi.cc` library is retained through process exit. One HWND at a time
is owned; invalid, foreign-process, child, non-per-monitor-DPI-aware, or already-owned handles are rejected.
The controller exposes `readGeometry(): WindowChromeGeometry | null` and
`setAppearance({ backgroundColor: number | null, dark: boolean }): void`. Colors are integral `0xRRGGBB`
values; null restores the OS default. Validated RGB is materialized as a signed 32-bit JavaScript integer
before FFI: Bun 1.4.0's integer arguments do not reliably coerce boxed doubles. Invalid appearance and
unsuccessful appearance synchronization throw.
Geometry reads explicitly synchronize native layout, including after a new document, and return null when
measurement, supported child ownership, window lifetime, or the bounded UI-thread request is unavailable.
No JavaScript window-state cache, polling, callback, disposal, or close operation is added.

Installation only establishes the public HWND subclass and its ownership marker from the Bun caller thread;
creation on the window thread is rejected because same-thread sends cannot time out. All subsequent GUI
mutation runs on the window thread. A registered message and one locked, copied native request slot provide
synchronous dispatch with a 500ms send timeout; parameters are identity tokens, never caller pointers.
Timeout cannot leave a borrowed output buffer or appearance object on the UI thread. Already-running work
may finish afterward, and the slot cannot be reused beneath it.
PID, thread, ownership marker, and generation checks prevent an old controller from targeting a reused HWND.
Native destruction restores the original procedure, releases owned GDI resources, and ends ownership; the
compiled callback cannot be unloaded beneath the framework. Original close handling remains untouched.

## Native layout and appearance

Framed windows regain `WS_SYSMENU`, `WS_MINIMIZEBOX`, and `WS_MAXIMIZEBOX` by adding only those bits.
Fullscreen uses the pinned SDK's native predicate: `WS_POPUP` without `WS_OVERLAPPEDWINDOW`, including when
`WS_MAXIMIZE` or `WS_MINIMIZE` remains set. Entering fullscreen from maximized preserves that state bit;
excluding `IsZoomed` would wrongly restore frame-control bits and prevent the SDK from recognizing or leaving
fullscreen. Fullscreen restores the default child region and reports zero insets. Minimized/invisible framed
windows have no reliable caption measurement. Resize hit testing covers all eight edges/corners in physical screen
pixels with signed message coordinates; maximized, minimized, fullscreen, and non-resizable windows do not
acquire resize hits. DWM receives non-client processing for real caption behavior, including maximize hover.

The supported direct child must be the sole child and cover the physical client rectangle. Only its default
region, a full-size rectangle, or this helper's last owned region can be replaced. Unexpected children or
custom masks are not composed or overwritten. The helper releases its own mask when that boundary stops
holding. A replacement child can be acquired on explicit synchronization. Region exclusion uses the actual
DWM caption rectangle and, when restored/resizable, the top resize band; the ordinary non-client frame owns
the remaining edges. Masks are reapplied after the original resize/DPI/style handling, never before it.

Caption bounds are window-relative physical pixels, DWM visible-frame bounds are screen-relative physical
pixels, and web insets are client-relative CSS pixels. Windows dispatch enters the HWND's per-monitor DPI
context, keeping `GetWindowRect` and client mapping physical rather than mixing DPI-virtualized bounds with
DWM pixels. No process/thread DPI policy is changed by this helper. Measurement converts these spaces using
the actual client origin/extent and window DPI. Both sides account for visible-frame clipping and the measured
caption side; no constant button width or unconditional right-side assumption substitutes for geometry.
The 40-CSS-pixel header frame extension also covers the measured caption height.

Only exposed header backing is painted. The caption backing is black so DWM composes its own glyphs; the
remaining exposed header uses the validated background RGB or OS default. Dark mode and caption color use
public DWM attributes. Unsupported caption color attribute 35 on Windows 10 is nonfatal and does not replace
native controls with private APIs or a second renderer.

## Verification and qualification

Headless tests cover validation, physical layout/hit-test arithmetic, and Windows C compilation/linking plus
invalid/null handle rejection without creating windows or sending GUI input. These cannot establish native
interaction or accessibility. The isolated probe established one genuine Windows 11 Snap selection, real
DWM glyphs after black backing paint, and eight-edge input ownership/hit codes; this primitive has not repeated
those interactions in a packaged application. A packaged Windows 11, 96-DPI smoke covers native maximize and
restore, fullscreen/reload from both entry states, matching frame/inset restoration, and control-file graceful
shutdown. UIA remains unresolved. Actual control input/Snap/resize, DPI/display changes, theme/high contrast,
replacement-child lifetime, configured gestures/menus, native close input/update restart, and Windows 10 still
require target-native qualification before ordinary Windows policy may be enabled.

References: [window-rectangle virtualization](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect),
[window-procedure DPI context](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-improvements-for-desktop-applications).
