#include <stddef.h>

#if !defined(_WIN32) || !defined(_WIN64)
#error Windows chrome requires Windows x64
#endif

_Static_assert(sizeof(void *) == 8 && sizeof(wchar_t) == 2 && sizeof(int) == 4 &&
  sizeof(short) == 2 && sizeof(long long) == 8, "Windows x64 ABI required");

typedef short int16_t;
typedef int int32_t;
typedef long long int64_t;
typedef unsigned int uint32_t;
typedef unsigned long long uintptr_t;
typedef long long intptr_t;
#define UINT32_MAX 0xffffffffu

typedef void *HWND;
typedef void *HANDLE;
typedef void *HRGN;
typedef void *HDC;
typedef void *HBRUSH;
typedef uint32_t UINT;
typedef uint32_t DWORD;
typedef int BOOL;
typedef intptr_t LONG_PTR;
typedef uintptr_t WPARAM;
typedef intptr_t LPARAM;
typedef intptr_t LRESULT;
typedef struct { int32_t left, top, right, bottom; } RECT;
typedef struct { int32_t x, y; } POINT;
typedef struct { int left, right, top, bottom; } MARGINS;
typedef struct { HDC dc; BOOL erase; RECT rect; BOOL restore, update; unsigned char reserved[32]; } PAINTSTRUCT;
typedef struct { void *value; } SRWLOCK;
typedef LRESULT (*WNDPROC)(HWND, UINT, WPARAM, LPARAM);

BOOL IsWindow(HWND);
BOOL IsWindowVisible(HWND);
BOOL IsZoomed(HWND);
BOOL IsIconic(HWND);
DWORD GetCurrentProcessId(void);
DWORD GetCurrentThreadId(void);
DWORD GetWindowThreadProcessId(HWND, DWORD *);
HWND GetAncestor(HWND, UINT);
HWND GetParent(HWND);
HWND GetWindow(HWND, UINT);
LONG_PTR GetWindowLongPtrW(HWND, int);
LONG_PTR SetWindowLongPtrW(HWND, int, LONG_PTR);
LRESULT CallWindowProcW(WNDPROC, HWND, UINT, WPARAM, LPARAM);
LRESULT DefWindowProcW(HWND, UINT, WPARAM, LPARAM);
HANDLE GetPropW(HWND, const wchar_t *);
BOOL SetPropW(HWND, const wchar_t *, HANDLE);
HANDLE RemovePropW(HWND, const wchar_t *);
UINT RegisterWindowMessageW(const wchar_t *);
LRESULT SendMessageTimeoutW(HWND, UINT, WPARAM, LPARAM, UINT, UINT, uintptr_t *);
void AcquireSRWLockExclusive(SRWLOCK *);
void ReleaseSRWLockExclusive(SRWLOCK *);
void SetLastError(DWORD);
DWORD GetLastError(void);
BOOL SetWindowPos(HWND, HWND, int, int, int, int, UINT);
BOOL GetWindowRect(HWND, RECT *);
BOOL GetClientRect(HWND, RECT *);
int MapWindowPoints(HWND, HWND, POINT *, UINT);
UINT GetDpiForWindow(HWND);
HANDLE GetWindowDpiAwarenessContext(HWND);
int GetAwarenessFromDpiAwarenessContext(HANDLE);
int GetSystemMetricsForDpi(int, UINT);
BOOL DwmDefWindowProc(HWND, UINT, WPARAM, LPARAM, LRESULT *);
int DwmExtendFrameIntoClientArea(HWND, const MARGINS *);
int DwmGetWindowAttribute(HWND, UINT, void *, UINT);
int DwmSetWindowAttribute(HWND, UINT, const void *, UINT);
HRGN CreateRectRgn(int, int, int, int);
int CombineRgn(HRGN, HRGN, HRGN, int);
BOOL EqualRgn(HRGN, HRGN);
BOOL PtInRegion(HRGN, int, int);
BOOL DeleteObject(HANDLE);
int GetWindowRgn(HWND, HRGN);
int SetWindowRgn(HWND, HRGN, BOOL);
HDC BeginPaint(HWND, PAINTSTRUCT *);
BOOL EndPaint(HWND, const PAINTSTRUCT *);
int FillRect(HDC, const RECT *, HBRUSH);
HBRUSH CreateSolidBrush(DWORD);
HBRUSH GetSysColorBrush(int);
HANDLE GetStockObject(int);
DWORD SetLayout(HDC, DWORD);
BOOL InvalidateRect(HWND, const RECT *, BOOL);

enum {
  GWLP_WNDPROC = -4, GWL_STYLE = -16, GWL_EXSTYLE = -20,
  WS_CHILD = 0x40000000, WS_CAPTION = 0x00c00000, WS_THICKFRAME = 0x00040000,
  WS_POPUP = 0x80000000, WS_OVERLAPPEDWINDOW = 0x00cf0000,
  WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000,
  WS_EX_LAYOUTRTL = 0x00400000, DPI_AWARENESS_PER_MONITOR_AWARE = 2,
  GW_HWNDNEXT = 2, GW_CHILD = 5, GA_ROOT = 2,
  WM_SIZE = 0x0005, WM_PAINT = 0x000f, WM_CLOSE = 0x0010, WM_ERASEBKGND = 0x0014,
  WM_SHOWWINDOW = 0x0018, WM_SETTINGCHANGE = 0x001a, WM_WINDOWPOSCHANGED = 0x0047,
  WM_STYLECHANGED = 0x007d, WM_DISPLAYCHANGE = 0x007e,
  WM_NCDESTROY = 0x0082, WM_NCHITTEST = 0x0084, WM_SYSCOMMAND = 0x0112, WM_PARENTNOTIFY = 0x0210,
  WM_DPICHANGED = 0x02e0, WM_THEMECHANGED = 0x031a, WM_DWMCOMPOSITIONCHANGED = 0x031e,
  HTCLIENT = 1, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13,
  HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17,
  SM_CXSIZEFRAME = 32, SM_CYSIZEFRAME = 33, SM_CXPADDEDBORDER = 92,
  DWMWA_CAPTION_BUTTON_BOUNDS = 5, DWMWA_EXTENDED_FRAME_BOUNDS = 9,
  DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_CAPTION_COLOR = 35,
  SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOZORDER = 4, SWP_NOACTIVATE = 16, SWP_FRAMECHANGED = 32,
  SMTO_BLOCK = 1, SMTO_ABORTIFHUNG = 2, SMTO_ERRORONEXIT = 32, REQUEST_TIMEOUT_MS = 500,
  RGN_DIFF = 4, RGN_COPY = 5, BLACK_BRUSH = 4, COLOR_WINDOW = 5,
  REQUEST_SYNC = 1, REQUEST_APPEARANCE = 2,
  SLOT_IDLE = 0, SLOT_PENDING = 1, SLOT_RUNNING = 2, SLOT_DONE = 3
};

typedef struct {
  RECT window, client, visible, caption;
  UINT dpi;
  int border_y, resizable, header_height;
} Layout;

typedef struct {
  HWND window, child;
  WNDPROC original;
  DWORD thread;
  UINT generation;
  HRGN mask;
  int background, dark, syncing;
} Chrome;

typedef struct {
  UINT sequence, generation;
  int status, waiting, kind, background, dark, success;
  double geometry[2];
} Request;

static SRWLOCK lock;
static Chrome chrome = { .background = -1 };
static Request request;
static UINT sync_message;
static const wchar_t ownership_key[] = L"ThinkRail.WindowsChrome.5e23f158-6e23-450e-bca7-cb22ed22d93f";
static LRESULT window_proc(HWND, UINT, WPARAM, LPARAM);

static int minimum(int a, int b) { return a < b ? a : b; }
static int maximum(int a, int b) { return a > b ? a : b; }
static int valid_rect(RECT r) { return r.left < r.right && r.top < r.bottom; }
static int same_rect(RECT a, RECT b) {
  return a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom;
}

static RECT intersection(RECT a, RECT b) {
  RECT result = { maximum(a.left, b.left), maximum(a.top, b.top),
    minimum(a.right, b.right), minimum(a.bottom, b.bottom) };
  return result;
}

static RECT caption_in_screen(RECT window, RECT caption) {
  RECT result = { window.left + caption.left, window.top + caption.top,
    window.left + caption.right, window.top + caption.bottom };
  return result;
}

static int header_height(UINT dpi) { return (int)(((int64_t)40 * dpi + 95) / 96); }

static int resize_border(UINT dpi, int metric) {
  return GetSystemMetricsForDpi(metric, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
}

static int fullscreen(LONG_PTR style) {
  return (style & WS_POPUP) && !(style & WS_OVERLAPPEDWINDOW);
}

static LONG_PTR controls_style(LONG_PTR style) {
  return style | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
}

static int resizable(LONG_PTR style, int zoomed, int iconic) {
  return !zoomed && !iconic && (style & WS_THICKFRAME) != 0;
}

static LRESULT resize_hit(RECT frame, LPARAM position, int border_x, int border_y, int enabled) {
  int x = (int16_t)((uintptr_t)position & 0xffff);
  int y = (int16_t)(((uintptr_t)position >> 16) & 0xffff);
  if (!enabled || !valid_rect(frame) || border_x <= 0 || border_y <= 0 ||
      x < frame.left || x >= frame.right || y < frame.top || y >= frame.bottom) return 0;
  border_x = minimum(border_x, (frame.right - frame.left) / 2);
  border_y = minimum(border_y, (frame.bottom - frame.top) / 2);
  int left = x < frame.left + border_x;
  int right = x >= frame.right - border_x;
  if (y < frame.top + border_y) return left ? HTTOPLEFT : right ? HTTOPRIGHT : HTTOP;
  if (y >= frame.bottom - border_y) return left ? HTBOTTOMLEFT : right ? HTBOTTOMRIGHT : HTBOTTOM;
  return left ? HTLEFT : right ? HTRIGHT : 0;
}

static int layout_geometry(const Layout *layout, double *output) {
  if (!layout->dpi || !valid_rect(layout->client) || !valid_rect(layout->visible) ||
      !valid_rect(layout->caption)) return 0;
  RECT visible = intersection(layout->client, layout->visible);
  RECT caption = intersection(visible, layout->caption);
  if (!valid_rect(visible) || !valid_rect(caption)) return 0;
  int left = visible.left - layout->client.left;
  int right = layout->client.right - visible.right;
  if ((int64_t)caption.left + caption.right < (int64_t)visible.left + visible.right) {
    left = maximum(left, caption.right - layout->client.left);
  } else {
    right = maximum(right, layout->client.right - caption.left);
  }
  output[0] = (double)left * 96 / layout->dpi;
  output[1] = (double)right * 96 / layout->dpi;
  return 1;
}

static DWORD caption_color(int background) {
  if (background == -1) return UINT32_MAX;
  return ((DWORD)background & 0x00ff00) | (((DWORD)background & 0xff0000) >> 16) |
    (((DWORD)background & 0x0000ff) << 16);
}

static int owns_window(HWND window, UINT generation) {
  DWORD pid = 0;
  DWORD thread = GetWindowThreadProcessId(window, &pid);
  return window && window == chrome.window && generation && generation == chrome.generation &&
    thread && thread == chrome.thread && pid == GetCurrentProcessId() && IsWindow(window) &&
    GetPropW(window, ownership_key) == (HANDLE)(uintptr_t)generation;
}

static int live_on_ui(HWND window) {
  AcquireSRWLockExclusive(&lock);
  int result = owns_window(window, chrome.generation) && GetCurrentThreadId() == chrome.thread;
  ReleaseSRWLockExclusive(&lock);
  return result;
}

static int client_bounds(HWND window, RECT *bounds) {
  if (!GetClientRect(window, bounds) || !valid_rect(*bounds)) return 0;
  SetLastError(0);
  if (!MapWindowPoints(window, 0, (POINT *)bounds, 2) && GetLastError()) return 0;
  return valid_rect(*bounds);
}

static int measure_layout(HWND window, Layout *layout) {
  LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
  int zoomed = IsZoomed(window), iconic = IsIconic(window);
  if (iconic || fullscreen(style) || !IsWindowVisible(window)) return 0;
  layout->dpi = GetDpiForWindow(window);
  if (!layout->dpi || !GetWindowRect(window, &layout->window) ||
      !client_bounds(window, &layout->client) ||
      DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &layout->visible, sizeof(RECT)) < 0 ||
      DwmGetWindowAttribute(window, DWMWA_CAPTION_BUTTON_BOUNDS, &layout->caption, sizeof(RECT)) < 0 ||
      !valid_rect(layout->window) || !valid_rect(layout->caption)) return 0;
  layout->caption = caption_in_screen(layout->window, layout->caption);
  layout->border_y = resize_border(layout->dpi, SM_CYSIZEFRAME);
  layout->resizable = resizable(style, zoomed, iconic);
  layout->header_height = minimum(layout->client.bottom - layout->client.top,
    maximum(header_height(layout->dpi), layout->caption.bottom - layout->client.top));
  return 1;
}

static void forget_mask(void) {
  if (chrome.mask) DeleteObject(chrome.mask);
  chrome.mask = 0;
  chrome.child = 0;
}

static int release_mask(HWND window) {
  if (!chrome.mask) return 1;
  HRGN current = CreateRectRgn(0, 0, 0, 0);
  if (!current) return 0;
  int restored = 1;
  if (GetParent(chrome.child) == window && GetWindowRgn(chrome.child, current) &&
      EqualRgn(current, chrome.mask)) restored = SetWindowRgn(chrome.child, 0, 1) != 0;
  DeleteObject(current);
  if (restored) forget_mask();
  return restored;
}

static int subtract_region(HRGN region, RECT hole, RECT child, int mirrored) {
  hole = intersection(hole, child);
  if (!valid_rect(hole)) return 1;
  int left = mirrored ? child.right - hole.right : hole.left - child.left;
  int right = mirrored ? child.right - hole.left : hole.right - child.left;
  HRGN excluded = CreateRectRgn(left, hole.top - child.top, right, hole.bottom - child.top);
  if (!excluded) return 0;
  int result = CombineRgn(region, region, excluded, RGN_DIFF);
  DeleteObject(excluded);
  return result != 0;
}

static int exclude_native_input(HRGN region, const Layout *layout, RECT child, int mirrored) {
  RECT top = { child.left, layout->window.top, child.right, layout->window.top + layout->border_y };
  return subtract_region(region, layout->caption, child, mirrored) &&
    (!layout->resizable || subtract_region(region, top, child, mirrored));
}

static int apply_mask(HWND window, const Layout *layout) {
  HWND child = GetWindow(window, GW_CHILD);
  RECT bounds;
  DWORD pid = 0;
  DWORD thread = GetWindowThreadProcessId(child, &pid);
  if (!child || GetWindow(child, GW_HWNDNEXT) || GetParent(child) != window ||
      pid != GetCurrentProcessId() || thread != GetCurrentThreadId() ||
      !GetWindowRect(child, &bounds) || !same_rect(bounds, layout->client)) return 0;
  HRGN current = CreateRectRgn(0, 0, 0, 0);
  HRGN next = CreateRectRgn(0, 0, bounds.right - bounds.left, bounds.bottom - bounds.top);
  if (!current || !next) {
    if (current) DeleteObject(current);
    if (next) DeleteObject(next);
    return 0;
  }
  int kind = GetWindowRgn(child, current);
  int allowed = !kind || EqualRgn(current, next) ||
    (child == chrome.child && chrome.mask && EqualRgn(current, chrome.mask));
  int mirrored = (GetWindowLongPtrW(child, GWL_EXSTYLE) & WS_EX_LAYOUTRTL) != 0;
  if (!allowed || !exclude_native_input(next, layout, bounds, mirrored)) {
    DeleteObject(current);
    DeleteObject(next);
    return 0;
  }
  int unchanged = kind && EqualRgn(current, next);
  if (!CombineRgn(current, next, 0, RGN_COPY) || (!unchanged && !SetWindowRgn(child, next, 1))) {
    DeleteObject(current);
    DeleteObject(next);
    return 0;
  }
  if (unchanged) DeleteObject(next);
  if (!live_on_ui(window)) {
    DeleteObject(current);
    return 0;
  }
  forget_mask();
  chrome.child = child;
  chrome.mask = current;
  return 1;
}

static void apply_appearance(HWND window) {
  DWORD color = caption_color(chrome.background);
  DwmSetWindowAttribute(window, DWMWA_USE_IMMERSIVE_DARK_MODE, &chrome.dark, sizeof(chrome.dark));
  DwmSetWindowAttribute(window, DWMWA_CAPTION_COLOR, &color, sizeof(color));
}

static int synchronize(HWND window, double *geometry) {
  AcquireSRWLockExclusive(&lock);
  if (chrome.syncing || !owns_window(window, chrome.generation) || GetCurrentThreadId() != chrome.thread) {
    ReleaseSRWLockExclusive(&lock);
    return 0;
  }
  chrome.syncing = 1;
  ReleaseSRWLockExclusive(&lock);
  int success = 0;
  do {
    LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
    int full = fullscreen(style);
    if (!full && style != controls_style(style)) {
      SetLastError(0);
      if (!SetWindowLongPtrW(window, GWL_STYLE, controls_style(style)) && GetLastError()) break;
      if (!SetWindowPos(window, 0, 0, 0, 0, 0,
          SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)) break;
      if (!live_on_ui(window)) break;
    }
    apply_appearance(window);
    MARGINS margins = { 0, 0, 0, 0 };
    if (full) {
      DwmExtendFrameIntoClientArea(window, &margins);
      if (!live_on_ui(window) || !release_mask(window)) break;
      geometry[0] = geometry[1] = 0;
      success = 1;
      break;
    }
    UINT dpi = GetDpiForWindow(window);
    if (!dpi) break;
    margins.top = header_height(dpi);
    if (DwmExtendFrameIntoClientArea(window, &margins) < 0 || !live_on_ui(window)) break;
    Layout layout;
    if (!measure_layout(window, &layout) || !layout_geometry(&layout, geometry)) break;
    if (layout.header_height != margins.top) {
      margins.top = layout.header_height;
      if (DwmExtendFrameIntoClientArea(window, &margins) < 0) break;
    }
    if (!apply_mask(window, &layout) || !live_on_ui(window)) break;
    RECT header = { 0, 0, layout.client.right - layout.client.left, layout.header_height };
    InvalidateRect(window, &header, 0);
    success = 1;
  } while (0);
  if (!success && live_on_ui(window)) release_mask(window);
  AcquireSRWLockExclusive(&lock);
  chrome.syncing = 0;
  ReleaseSRWLockExclusive(&lock);
  return success;
}

static int paint_header(HWND window, HDC dc) {
  Layout layout;
  if (!chrome.mask || !measure_layout(window, &layout)) return 0;
  HBRUSH background = chrome.background == -1 ? GetSysColorBrush(COLOR_WINDOW) :
    CreateSolidBrush(caption_color(chrome.background));
  if (!background) return 0;
  RECT header = { 0, 0, layout.client.right - layout.client.left, layout.header_height };
  RECT caption = intersection(layout.caption, layout.client);
  caption.left -= layout.client.left;
  caption.right -= layout.client.left;
  caption.top -= layout.client.top;
  caption.bottom -= layout.client.top;
  DWORD previous_layout = SetLayout(dc, 0);
  FillRect(dc, &header, background);
  if (valid_rect(caption)) FillRect(dc, &caption, GetStockObject(BLACK_BRUSH));
  if (previous_layout != UINT32_MAX) SetLayout(dc, previous_layout);
  if (chrome.background != -1) DeleteObject(background);
  return 1;
}

static int refresh_message(UINT message) {
  return message == WM_SIZE || message == WM_WINDOWPOSCHANGED || message == WM_DPICHANGED ||
    message == WM_STYLECHANGED || message == WM_SHOWWINDOW || message == WM_PARENTNOTIFY ||
    message == WM_DISPLAYCHANGE || message == WM_THEMECHANGED || message == WM_SETTINGCHANGE ||
    message == WM_DWMCOMPOSITIONCHANGED;
}

static LRESULT receive_request(HWND window, WPARAM sequence, LPARAM generation) {
  AcquireSRWLockExclusive(&lock);
  if (sequence != request.sequence || (uintptr_t)generation != request.generation ||
      request.status != SLOT_PENDING || !owns_window(window, request.generation) ||
      GetCurrentThreadId() != chrome.thread) {
    ReleaseSRWLockExclusive(&lock);
    return 0;
  }
  request.status = SLOT_RUNNING;
  int kind = request.kind, background = request.background, dark = request.dark;
  ReleaseSRWLockExclusive(&lock);
  double geometry[2] = { 0, 0 };
  int success = 0;
  if (!chrome.syncing) {
    if (kind == REQUEST_APPEARANCE) {
      chrome.background = background;
      chrome.dark = dark;
    }
    success = synchronize(window, geometry);
  }
  AcquireSRWLockExclusive(&lock);
  request.success = success && owns_window(window, (UINT)generation);
  request.geometry[0] = geometry[0];
  request.geometry[1] = geometry[1];
  request.status = request.waiting ? SLOT_DONE : SLOT_IDLE;
  ReleaseSRWLockExclusive(&lock);
  return 1;
}

static LRESULT window_proc(HWND window, UINT message, WPARAM w, LPARAM l) {
  AcquireSRWLockExclusive(&lock);
  WNDPROC original = window == chrome.window ? chrome.original : 0;
  ReleaseSRWLockExclusive(&lock);
  if (!original) return DefWindowProcW(window, message, w, l);
  if (message == sync_message) return receive_request(window, w, l);
  if (message == WM_NCDESTROY) {
    forget_mask();
    AcquireSRWLockExclusive(&lock);
    if (GetWindowLongPtrW(window, GWLP_WNDPROC) == (LONG_PTR)window_proc) {
      SetWindowLongPtrW(window, GWLP_WNDPROC, (LONG_PTR)original);
    }
    if (GetPropW(window, ownership_key) == (HANDLE)(uintptr_t)chrome.generation) {
      RemovePropW(window, ownership_key);
    }
    chrome.window = 0;
    chrome.original = 0;
    ReleaseSRWLockExclusive(&lock);
    return CallWindowProcW(original, window, message, w, l);
  }
  if (message == WM_CLOSE || message == WM_SYSCOMMAND) {
    return CallWindowProcW(original, window, message, w, l);
  }
  if (message == WM_NCHITTEST) {
    LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
    int zoomed = IsZoomed(window), iconic = IsIconic(window);
    int enabled = resizable(style, zoomed, iconic);
    LRESULT dwm_result = 0;
    BOOL handled = !fullscreen(style) && DwmDefWindowProc(window, message, w, l, &dwm_result);
    RECT frame;
    UINT dpi = GetDpiForWindow(window);
    if (enabled && dpi && GetWindowRect(window, &frame)) {
      LRESULT hit = resize_hit(frame, l, resize_border(dpi, SM_CXSIZEFRAME),
        resize_border(dpi, SM_CYSIZEFRAME), enabled);
      if (hit) return hit;
    }
    LRESULT result = handled ? dwm_result : CallWindowProcW(original, window, message, w, l);
    return !enabled && result >= HTLEFT && result <= HTBOTTOMRIGHT ? HTCLIENT : result;
  }
  if (message == WM_ERASEBKGND && paint_header(window, (HDC)w)) return 1;
  if (message == WM_PAINT && chrome.mask) {
    PAINTSTRUCT paint;
    HDC dc = BeginPaint(window, &paint);
    if (dc) {
      paint_header(window, dc);
      EndPaint(window, &paint);
    }
    return 0;
  }
  LRESULT dwm_result = 0;
  BOOL handled = DwmDefWindowProc(window, message, w, l, &dwm_result);
  int refresh = refresh_message(message);
  if (handled && !refresh) return dwm_result;
  LRESULT result = CallWindowProcW(original, window, message, w, l);
  if (refresh) {
    double geometry[2];
    synchronize(window, geometry);
  }
  return result;
}

static int dispatch(HWND window, UINT generation, int kind, int background, int dark, double *output) {
  AcquireSRWLockExclusive(&lock);
  if (!owns_window(window, generation) || request.status != SLOT_IDLE || request.sequence == UINT32_MAX) {
    ReleaseSRWLockExclusive(&lock);
    return 0;
  }
  UINT sequence = ++request.sequence;
  request.generation = generation;
  request.kind = kind;
  request.background = background;
  request.dark = dark;
  request.success = 0;
  request.waiting = 1;
  request.status = SLOT_PENDING;
  ReleaseSRWLockExclusive(&lock);
  uintptr_t reply = 0;
  LRESULT sent = SendMessageTimeoutW(window, sync_message, sequence, generation,
    SMTO_BLOCK | SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT, REQUEST_TIMEOUT_MS, &reply);
  AcquireSRWLockExclusive(&lock);
  int success = sent && reply && request.status == SLOT_DONE && request.success && owns_window(window, generation);
  if (success && output) {
    output[0] = request.geometry[0];
    output[1] = request.geometry[1];
  }
  if (request.status == SLOT_RUNNING) request.waiting = 0;
  else request.status = SLOT_IDLE;
  ReleaseSRWLockExclusive(&lock);
  return success;
}

UINT windows_chrome_install(HWND window) {
  AcquireSRWLockExclusive(&lock);
  DWORD pid = 0;
  DWORD thread = GetWindowThreadProcessId(window, &pid);
  if (!window || !IsWindow(window) || !thread || thread == GetCurrentThreadId() ||
      pid != GetCurrentProcessId() || GetAncestor(window, GA_ROOT) != window ||
      (GetWindowLongPtrW(window, GWL_STYLE) & WS_CHILD) ||
      GetAwarenessFromDpiAwarenessContext(GetWindowDpiAwarenessContext(window)) != DPI_AWARENESS_PER_MONITOR_AWARE ||
      GetPropW(window, ownership_key) ||
      chrome.window || chrome.syncing || chrome.generation == UINT32_MAX || request.status != SLOT_IDLE) {
    ReleaseSRWLockExclusive(&lock);
    return 0;
  }
  if (!sync_message) sync_message = RegisterWindowMessageW(ownership_key);
  WNDPROC original = (WNDPROC)GetWindowLongPtrW(window, GWLP_WNDPROC);
  UINT generation = chrome.generation + 1;
  if (!sync_message || !original || !SetPropW(window, ownership_key, (HANDLE)(uintptr_t)generation)) {
    ReleaseSRWLockExclusive(&lock);
    return 0;
  }
  chrome.window = window;
  chrome.original = original;
  chrome.thread = thread;
  chrome.generation = generation;
  chrome.background = -1;
  chrome.dark = 0;
  SetLastError(0);
  LONG_PTR previous = SetWindowLongPtrW(window, GWLP_WNDPROC, (LONG_PTR)window_proc);
  if (!previous) {
    RemovePropW(window, ownership_key);
    chrome.window = 0;
    chrome.original = 0;
    ReleaseSRWLockExclusive(&lock);
    return 0;
  }
  chrome.original = (WNDPROC)previous;
  ReleaseSRWLockExclusive(&lock);
  dispatch(window, generation, REQUEST_SYNC, -1, 0, 0);
  return generation;
}

int windows_chrome_read(HWND window, UINT generation, double *output) {
  return output && dispatch(window, generation, REQUEST_SYNC, 0, 0, output);
}

int windows_chrome_appearance(HWND window, UINT generation, int background, int dark) {
  if (background < -1 || background > 0xffffff || (dark != 0 && dark != 1)) return 0;
  return dispatch(window, generation, REQUEST_APPEARANCE, background, dark, 0);
}

#ifdef WINDOWS_CHROME_TEST
int windows_chrome_test_resize(const RECT *frame, LPARAM point, int border_x, int border_y,
    LONG_PTR style, int zoomed, int iconic) {
  return resize_hit(*frame, point, border_x, border_y, resizable(style, zoomed, iconic));
}

int windows_chrome_test_fullscreen(LONG_PTR style) {
  return fullscreen(style);
}

static Layout test_layout(const RECT *rects, UINT dpi) {
  Layout layout = { .window = rects[0], .client = rects[1], .visible = rects[2],
    .caption = caption_in_screen(rects[0], rects[3]), .dpi = dpi };
  return layout;
}

int windows_chrome_test_geometry(const RECT *rects, UINT dpi, double *output) {
  Layout layout = test_layout(rects, dpi);
  return layout_geometry(&layout, output);
}

int windows_chrome_test_region(const RECT *rects, int border_y, int enabled, int mirrored, int x, int y) {
  Layout layout = test_layout(rects, 96);
  layout.border_y = border_y;
  layout.resizable = enabled;
  HRGN region = CreateRectRgn(0, 0, layout.client.right - layout.client.left,
    layout.client.bottom - layout.client.top);
  if (!region) return -1;
  int result = exclude_native_input(region, &layout, layout.client, mirrored) ? PtInRegion(region, x, y) : -1;
  DeleteObject(region);
  return result;
}

DWORD windows_chrome_test_color(int background) { return caption_color(background); }
LONG_PTR windows_chrome_test_style(LONG_PTR style) { return controls_style(style); }
#endif
