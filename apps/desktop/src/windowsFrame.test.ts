import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { expect, test } from "bun:test";
import {
	restoreWindowsFrameControls,
	WS_MAXIMIZEBOX,
	WS_MINIMIZEBOX,
	WS_SYSMENU,
	windowsFrameControlsStyle,
} from "./windowsFrame";

const frameControlBits = WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
const windowHandle = 1 as unknown as Pointer;

test("adds all Windows frame control style bits", () => {
	expect(windowsFrameControlsStyle(0n)).toBe(frameControlBits);
	expect(windowsFrameControlsStyle(0x16c40000n)).toBe(0x16cf0000n);
	expect(windowsFrameControlsStyle(frameControlBits)).toBe(frameControlBits);
	expect(windowsFrameControlsStyle(0x8000000000000000n)).toBe(0x80000000000b0000n);
});

test("does not refresh an already complete frame style", () => {
	const calls: string[] = [];
	const api = {
		getStyle: () => frameControlBits,
		setStyle: () => {
			calls.push("set");
			return 1n;
		},
		refreshFrame: () => {
			calls.push("refresh");
			return true;
		},
	};
	expect(restoreWindowsFrameControls(windowHandle, api)).toBe(false);
	expect(calls).toEqual([]);
});

test("updates and refreshes an incomplete frame style", () => {
	const calls: Array<string | bigint> = [];
	const api = {
		getStyle: () => 0x16c40000n,
		setStyle: (_window: Pointer, style: bigint) => {
			calls.push(style);
			return 1n;
		},
		refreshFrame: () => {
			calls.push("refresh");
			return true;
		},
	};
	expect(restoreWindowsFrameControls(windowHandle, api)).toBe(true);
	expect(calls).toEqual([0x16cf0000n, "refresh"]);
});

test("throws when updating the frame style fails", () => {
	const api = {
		getStyle: () => 0n,
		setStyle: () => 0n,
		refreshFrame: () => true,
	};
	expect(() => restoreWindowsFrameControls(windowHandle, api)).toThrow(
		"Could not update the Windows window style",
	);
});

test("throws when refreshing the frame fails", () => {
	const api = {
		getStyle: () => 0n,
		setStyle: () => 1n,
		refreshFrame: () => false,
	};
	expect(() => restoreWindowsFrameControls(windowHandle, api)).toThrow(
		"Could not refresh the Windows window frame",
	);
});

test.skipIf(process.platform !== "win32")("binds the user32 style symbol", () => {
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
	expect(library.symbols.GetWindowLongPtrW(null as unknown as Pointer, -16)).toBe(0n);
});
