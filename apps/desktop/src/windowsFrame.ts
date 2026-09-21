import { dlopen, FFIType, type Pointer } from "bun:ffi";

const GWL_STYLE = -16;
export const WS_SYSMENU = 0x00080000n;
export const WS_MINIMIZEBOX = 0x00020000n;
export const WS_MAXIMIZEBOX = 0x00010000n;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_FRAME_REFRESH =
	SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;

export function windowsFrameControlsStyle(style: bigint): bigint {
	return style | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
}

export interface WindowsFrameApi {
	getStyle(window: Pointer): bigint;
	setStyle(window: Pointer, style: bigint): bigint;
	refreshFrame(window: Pointer): boolean;
}

export function restoreWindowsFrameControls(window: Pointer, api: WindowsFrameApi): boolean {
	const style = api.getStyle(window);
	const nextStyle = windowsFrameControlsStyle(style);
	if (nextStyle === style) return false;
	if (api.setStyle(window, nextStyle) === 0n) {
		throw new Error("Could not update the Windows window style");
	}
	if (!api.refreshFrame(window)) {
		throw new Error("Could not refresh the Windows window frame");
	}
	return true;
}

let cachedWindowsFrameApi: WindowsFrameApi | undefined;

export function loadWindowsFrameApi(): WindowsFrameApi {
	if (cachedWindowsFrameApi) return cachedWindowsFrameApi;
	const library = dlopen("user32.dll", {
		GetWindowLongPtrW: {
			args: [FFIType.ptr, FFIType.i32],
			returns: FFIType.i64,
		},
		SetWindowLongPtrW: {
			args: [FFIType.ptr, FFIType.i32, FFIType.i64],
			returns: FFIType.i64,
		},
		SetWindowPos: {
			args: [
				FFIType.ptr,
				FFIType.ptr,
				FFIType.i32,
				FFIType.i32,
				FFIType.i32,
				FFIType.i32,
				FFIType.u32,
			],
			returns: FFIType.bool,
		},
	});
	cachedWindowsFrameApi = {
		getStyle: (window) => BigInt(library.symbols.GetWindowLongPtrW(window, GWL_STYLE)),
		setStyle: (window, style) =>
			BigInt(library.symbols.SetWindowLongPtrW(window, GWL_STYLE, style)),
		refreshFrame: (window) =>
			library.symbols.SetWindowPos(window, null, 0, 0, 0, 0, SWP_FRAME_REFRESH),
	};
	return cachedWindowsFrameApi;
}
