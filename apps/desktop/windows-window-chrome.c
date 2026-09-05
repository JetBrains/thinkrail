#define WIN32_LEAN_AND_MEAN
#include <windows.h>

static HWND target_window;
static WNDPROC original_window_proc;

static LRESULT CALLBACK thinkrail_window_proc(
	HWND window,
	UINT message,
	WPARAM w_param,
	LPARAM l_param
) {
	WNDPROC original = original_window_proc;
	if (message == WM_NCDESTROY) {
		SetWindowLongPtrW(window, GWLP_WNDPROC, (LONG_PTR)original);
		target_window = NULL;
		original_window_proc = NULL;
		return CallWindowProcW(original, window, message, w_param, l_param);
	}
	LRESULT result = CallWindowProcW(original, window, message, w_param, l_param);
	if (message != WM_NCHITTEST || result != HTCLIENT || IsZoomed(window)) return result;
	POINT point = { (short)LOWORD(l_param), (short)HIWORD(l_param) };
	if (!ScreenToClient(window, &point)) return result;
	UINT dpi = GetDpiForWindow(window);
	int top_border = GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) +
		GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
	return point.y >= 0 && point.y < top_border ? HTTOP : result;
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
