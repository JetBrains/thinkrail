#define CALLBACK
#define DLLIMPORT
#define GWLP_WNDPROC -4
#define HTCLIENT 1
#define HTLEFT 10
#define HTRIGHT 11
#define HTTOP 12
#define HTTOPLEFT 13
#define HTTOPRIGHT 14
#define HTBOTTOM 15
#define HTBOTTOMLEFT 16
#define HTBOTTOMRIGHT 17
#define SM_CYSIZEFRAME 33
#define SM_CXPADDEDBORDER 92
#define WM_NCDESTROY 0x0082
#define WM_NCHITTEST 0x0084
#define WM_NCLBUTTONDOWN 0x00a1
#define THINKRAIL_WM_BEGIN_RESIZE 0x815a

typedef void *HWND;
typedef unsigned int UINT;
typedef int BOOL;
typedef unsigned long long WPARAM;
typedef long long LPARAM;
typedef long long LRESULT;
typedef long long LONG_PTR;
typedef short INT16;
typedef int INT32;
typedef struct { INT32 x; INT32 y; } POINT;
typedef struct { INT32 left; INT32 top; INT32 right; INT32 bottom; } RECT;
typedef LRESULT (CALLBACK *WNDPROC)(HWND, UINT, WPARAM, LPARAM);

DLLIMPORT LONG_PTR CALLBACK SetWindowLongPtrW(HWND, int, LONG_PTR);
DLLIMPORT LRESULT CALLBACK CallWindowProcW(WNDPROC, HWND, UINT, WPARAM, LPARAM);
DLLIMPORT BOOL CALLBACK IsZoomed(HWND);
DLLIMPORT BOOL CALLBACK ScreenToClient(HWND, POINT *);
DLLIMPORT BOOL CALLBACK GetCursorPos(POINT *);
DLLIMPORT BOOL CALLBACK GetWindowRect(HWND, RECT *);
DLLIMPORT HWND CALLBACK SetCapture(HWND);
DLLIMPORT BOOL CALLBACK ReleaseCapture(void);
DLLIMPORT BOOL CALLBACK PostMessageW(HWND, UINT, WPARAM, LPARAM);
DLLIMPORT UINT CALLBACK GetDpiForWindow(HWND);
DLLIMPORT int CALLBACK GetSystemMetricsForDpi(int, UINT);

static HWND target_window;
static WNDPROC original_window_proc;

static LRESULT CALLBACK thinkrail_window_proc(
	HWND window,
	UINT message,
	WPARAM w_param,
	LPARAM l_param
) {
	WNDPROC original = original_window_proc;
	if (message == THINKRAIL_WM_BEGIN_RESIZE) {
		SetCapture(window);
		ReleaseCapture();
		return CallWindowProcW(
			original,
			window,
			WM_NCLBUTTONDOWN,
			w_param,
			l_param
		);
	}
	if (message == WM_NCDESTROY) {
		SetWindowLongPtrW(window, GWLP_WNDPROC, (LONG_PTR)original);
		target_window = 0;
		original_window_proc = 0;
		return CallWindowProcW(original, window, message, w_param, l_param);
	}
	LRESULT result = CallWindowProcW(original, window, message, w_param, l_param);
	if (message != WM_NCHITTEST || result != HTCLIENT || IsZoomed(window)) return result;
	POINT point = {
		(INT16)(l_param & 0xffff),
		(INT16)((l_param >> 16) & 0xffff)
	};
	if (!ScreenToClient(window, &point)) return result;
	UINT dpi = GetDpiForWindow(window);
	int top_border = GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) +
		GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
	return point.y >= 0 && point.y < top_border ? HTTOP : result;
}

int thinkrail_windows_begin_resize(HWND window, int hit_test) {
	if (window != target_window) return 0;
	POINT point;
	RECT frame;
	if (!GetCursorPos(&point) || !GetWindowRect(window, &frame)) return 0;
	if (hit_test == HTLEFT || hit_test == HTTOPLEFT || hit_test == HTBOTTOMLEFT) {
		point.x = frame.left + 1;
	} else if (hit_test == HTRIGHT || hit_test == HTTOPRIGHT || hit_test == HTBOTTOMRIGHT) {
		point.x = frame.right - 1;
	}
	if (hit_test == HTTOP || hit_test == HTTOPLEFT || hit_test == HTTOPRIGHT) {
		point.y = frame.top + 1;
	} else if (hit_test == HTBOTTOM || hit_test == HTBOTTOMLEFT || hit_test == HTBOTTOMRIGHT) {
		point.y = frame.bottom - 1;
	}
	LPARAM packed = ((LPARAM)(point.y & 0xffff) << 16) | (point.x & 0xffff);
	return PostMessageW(window, THINKRAIL_WM_BEGIN_RESIZE, (WPARAM)hit_test, packed);
}

int thinkrail_windows_install_chrome(HWND window) {
	if (!window || target_window || original_window_proc) return 0;
	LONG_PTR original = SetWindowLongPtrW(
		window,
		GWLP_WNDPROC,
		(LONG_PTR)thinkrail_window_proc
	);
	if (!original) return 0;
	target_window = window;
	original_window_proc = (WNDPROC)original;
	return 1;
}
