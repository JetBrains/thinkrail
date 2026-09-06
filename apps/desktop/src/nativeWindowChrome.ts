import { cc, dlopen, FFIType, type Library, type Pointer } from "bun:ffi";
import { join } from "node:path";
import {
	type DesktopResizeEdge,
	linuxResizeEdgeCode,
	normalizeWindowsFrameStyle,
	windowsResizeHitTest,
} from "./windowChrome";

type WindowsLibrary = Library<{
	GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32]; returns: FFIType.i64 };
	SetWindowLongPtrW: {
		args: [FFIType.ptr, FFIType.i32, FFIType.i64];
		returns: FFIType.i64;
	};
	SetWindowPos: {
		args: [
			FFIType.ptr,
			FFIType.ptr,
			FFIType.i32,
			FFIType.i32,
			FFIType.i32,
			FFIType.i32,
			FFIType.u32,
		];
		returns: FFIType.bool;
	};
}>;

type WindowsChromeLibrary = Library<{
	thinkrail_windows_install_chrome: { args: [FFIType.ptr]; returns: FFIType.bool };
	thinkrail_windows_begin_resize: {
		args: [FFIType.ptr, FFIType.i32];
		returns: FFIType.bool;
	};
}>;

let windowsLibrary: WindowsLibrary | undefined;
let windowsChromeLibrary: WindowsChromeLibrary | undefined;

function asBigInt(value: number | bigint): bigint {
	return typeof value === "bigint" ? value : BigInt(value);
}

function getWindowsLibrary(): WindowsLibrary {
	windowsLibrary ??= dlopen("user32.dll", {
		GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
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
	return windowsLibrary;
}

export function preserveWindowsNativeFrame(handle: Pointer): boolean {
	const library = getWindowsLibrary();
	return normalizeWindowsFrameStyle(handle, {
		readStyle: (target) => asBigInt(library.symbols.GetWindowLongPtrW(target as Pointer, -16)),
		writeStyle: (target, style) => {
			const previous = asBigInt(library.symbols.SetWindowLongPtrW(target as Pointer, -16, style));
			if (previous === 0n) throw new Error("could not preserve Windows window capabilities");
		},
		refreshFrame: (target) => {
			const refreshed = library.symbols.SetWindowPos(target as Pointer, null, 0, 0, 0, 0, 0x37);
			if (!refreshed) throw new Error("could not refresh the Windows window frame");
		},
	});
}

export function installWindowsNativeChrome(
	runtimeDir: string,
	handle: Pointer,
): (edge: DesktopResizeEdge) => void {
	if (!windowsChromeLibrary) {
		windowsChromeLibrary = cc({
			source: Bun.file(join(runtimeDir, "windows-window-chrome.c")),
			library: "user32",
			symbols: {
				thinkrail_windows_install_chrome: { args: [FFIType.ptr], returns: FFIType.bool },
				thinkrail_windows_begin_resize: {
					args: [FFIType.ptr, FFIType.i32],
					returns: FFIType.bool,
				},
			},
		});
	}
	const library = windowsChromeLibrary;
	if (!library.symbols.thinkrail_windows_install_chrome(handle)) {
		throw new Error("could not install Windows native chrome integration");
	}
	return (edge) => {
		if (process.env.THINKRAIL_DESKTOP_NATIVE_INTERACTION === "1") {
			console.error(`[desktop] Windows resize queued edge=${edge}`);
		}
		if (!library.symbols.thinkrail_windows_begin_resize(handle, windowsResizeHitTest(edge))) {
			throw new Error(`could not start Windows window resize from ${edge}`);
		}
	};
}

export function createLinuxResizeStarter(
	runtimeDir: string,
	handle: Pointer,
): (edge: DesktopResizeEdge) => void {
	const library = cc({
		source: Bun.file(join(runtimeDir, "linux-window-resize.c")),
		symbols: {
			thinkrail_linux_resize_ready: { args: [], returns: FFIType.bool },
			thinkrail_linux_begin_resize: {
				args: [FFIType.ptr, FFIType.i32],
				returns: FFIType.bool,
			},
		},
	});
	if (!library.symbols.thinkrail_linux_resize_ready()) {
		throw new Error("GTK window resize integration is unavailable");
	}
	return (edge) => {
		if (!library.symbols.thinkrail_linux_begin_resize(handle, linuxResizeEdgeCode(edge))) {
			throw new Error(`could not start Linux window resize from ${edge}`);
		}
	};
}
