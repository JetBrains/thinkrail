import { cc, dlopen, FFIType, type Library, type Pointer, ptr } from "bun:ffi";
import { join } from "node:path";
import {
	type DesktopResizeEdge,
	linuxResizeEdgeCode,
	normalizeWindowsFrameStyle,
	windowsResizeCursor,
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
	GetCursorPos: { args: [FFIType.ptr]; returns: FFIType.bool };
	GetWindowRect: { args: [FFIType.ptr, FFIType.ptr]; returns: FFIType.bool };
	SetCursorPos: { args: [FFIType.i32, FFIType.i32]; returns: FFIType.bool };
	ReleaseCapture: { args: []; returns: FFIType.bool };
	SendMessageW: {
		args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64];
		returns: FFIType.i64;
	};
}>;

let windowsLibrary: WindowsLibrary | undefined;

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
		GetCursorPos: { args: [FFIType.ptr], returns: FFIType.bool },
		GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
		SetCursorPos: { args: [FFIType.i32, FFIType.i32], returns: FFIType.bool },
		ReleaseCapture: { args: [], returns: FFIType.bool },
		SendMessageW: {
			args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
			returns: FFIType.i64,
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

export function createWindowsResizeStarter(handle: Pointer): (edge: DesktopResizeEdge) => void {
	const library = getWindowsLibrary();
	return (edge) => {
		const point = new Int32Array(2);
		const frame = new Int32Array(4);
		if (
			!library.symbols.GetCursorPos(ptr(point)) ||
			!library.symbols.GetWindowRect(handle, ptr(frame))
		) {
			throw new Error("could not locate the pointer or frame for Windows window resize");
		}
		const pointView = new DataView(point.buffer);
		const frameView = new DataView(frame.buffer);
		const cursor = windowsResizeCursor(
			edge,
			{ x: pointView.getInt32(0, true), y: pointView.getInt32(4, true) },
			{
				left: frameView.getInt32(0, true),
				top: frameView.getInt32(4, true),
				right: frameView.getInt32(8, true),
				bottom: frameView.getInt32(12, true),
			},
		);
		if (!library.symbols.SetCursorPos(cursor.x, cursor.y)) {
			throw new Error("could not align the pointer for Windows window resize");
		}
		library.symbols.ReleaseCapture();
		const packedPoint = ((cursor.y & 0xffff) << 16) | (cursor.x & 0xffff);
		if (process.env.THINKRAIL_DESKTOP_NATIVE_INTERACTION === "1") {
			console.error(`[desktop] Windows resize queued edge=${edge}`);
		}
		library.symbols.SendMessageW(handle, 0x00a1, windowsResizeHitTest(edge), packedPoint);
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
