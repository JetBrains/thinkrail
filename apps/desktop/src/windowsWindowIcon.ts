import { dlopen, FFIType, type Pointer } from "bun:ffi";

const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const SM_CXICON = 11;
const SM_CXSMICON = 49;
const DEFAULT_DPI = 96;

export type WindowsHandle = Pointer | bigint;
export type WindowsIconKind = "small" | "big";

export interface WindowsIconApi {
	iconSizes(window: WindowsHandle): Record<WindowsIconKind, number>;
	loadIcon(path: string, size: number): WindowsHandle | null;
	setIcon(window: WindowsHandle, kind: WindowsIconKind, icon: WindowsHandle): void;
}

export function applyWindowsWindowIcon(
	window: WindowsHandle,
	iconPath: string,
	api: WindowsIconApi,
): void {
	const sizes = api.iconSizes(window);
	for (const kind of ["small", "big"] as const) {
		const icon = api.loadIcon(iconPath, sizes[kind]);
		if (!icon) throw new Error(`Could not load the ${kind} Windows window icon`);
		api.setIcon(window, kind, icon);
	}
}

let cachedWindowsIconApi: WindowsIconApi | undefined;

export function loadWindowsIconApi(): WindowsIconApi {
	if (cachedWindowsIconApi) return cachedWindowsIconApi;
	const library = dlopen("user32.dll", {
		GetDpiForWindow: { args: [FFIType.ptr], returns: FFIType.u32 },
		GetSystemMetricsForDpi: { args: [FFIType.i32, FFIType.u32], returns: FFIType.i32 },
		LoadImageW: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32],
			returns: FFIType.ptr,
		},
		SendMessageW: {
			args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr],
			returns: FFIType.ptr,
		},
	});
	cachedWindowsIconApi = {
		iconSizes: (window) => {
			const dpi = library.symbols.GetDpiForWindow(window) || DEFAULT_DPI;
			return {
				small: library.symbols.GetSystemMetricsForDpi(SM_CXSMICON, dpi),
				big: library.symbols.GetSystemMetricsForDpi(SM_CXICON, dpi),
			};
		},
		loadIcon: (path, size) =>
			library.symbols.LoadImageW(
				null,
				Buffer.from(`${path}\0`, "utf16le"),
				IMAGE_ICON,
				size,
				size,
				LR_LOADFROMFILE,
			),
		setIcon: (window, kind, icon) => {
			library.symbols.SendMessageW(
				window,
				WM_SETICON,
				kind === "big" ? ICON_BIG : ICON_SMALL,
				icon,
			);
		},
	};
	return cachedWindowsIconApi;
}
