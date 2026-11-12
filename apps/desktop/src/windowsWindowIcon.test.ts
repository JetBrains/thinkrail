import { dlopen, FFIType } from "bun:ffi";
import { expect, test } from "bun:test";
import { windowsIconPath } from "@thinkrail/shared/windowsIdentity";
import {
	applyWindowsWindowIcon,
	loadWindowsIconApi,
	type WindowsHandle,
	type WindowsIconApi,
} from "./windowsWindowIcon";

const iconPath = windowsIconPath;
const windowHandle = 1n;

function fakeIconApi(loads = true) {
	const calls: unknown[] = [];
	const api: WindowsIconApi = {
		iconSizes: () => ({ small: 24, big: 48 }),
		loadIcon: (path, size) => {
			calls.push(["load", path, size]);
			return loads ? BigInt(size) : null;
		},
		setIcon: (_window, kind, icon) => calls.push(["set", kind, icon]),
	};
	return { api, calls };
}

test("sets a small and a big icon sized for the window", () => {
	const { api, calls } = fakeIconApi();
	applyWindowsWindowIcon(windowHandle, iconPath, api);
	expect(calls).toEqual([
		["load", iconPath, 24],
		["set", "small", 24n],
		["load", iconPath, 48],
		["set", "big", 48n],
	]);
});

test("throws before setting anything when the icon cannot be loaded", () => {
	const { api, calls } = fakeIconApi(false);
	expect(() => applyWindowsWindowIcon(windowHandle, iconPath, api)).toThrow(
		"Could not load the small Windows window icon",
	);
	expect(calls).toEqual([["load", iconPath, 24]]);
});

test.skipIf(process.platform !== "win32")("sets the icon on a real window", () => {
	const api = loadWindowsIconApi();
	expect(loadWindowsIconApi()).toBe(api);
	const user32 = dlopen("user32.dll", {
		CreateWindowExW: {
			args: [
				FFIType.u32,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.u32,
				FFIType.i32,
				FFIType.i32,
				FFIType.i32,
				FFIType.i32,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.ptr,
			],
			returns: FFIType.ptr,
		},
		DestroyWindow: { args: [FFIType.ptr], returns: FFIType.bool },
		SendMessageW: {
			args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
			returns: FFIType.ptr,
		},
	});
	const className = Buffer.from("STATIC\0", "utf16le");
	const window = user32.symbols.CreateWindowExW(
		0,
		className,
		null,
		0,
		0,
		0,
		0,
		0,
		null,
		null,
		null,
		null,
	);
	if (!window) throw new Error("could not create a test window");
	try {
		const set: Partial<Record<string, WindowsHandle>> = {};
		applyWindowsWindowIcon(window, iconPath, {
			...api,
			setIcon: (target, kind, icon) => {
				set[kind] = icon;
				api.setIcon(target, kind, icon);
			},
		});
		const WM_GETICON = 0x007f;
		expect(user32.symbols.SendMessageW(window, WM_GETICON, 0, 0)).toBe(set.small ?? null);
		expect(user32.symbols.SendMessageW(window, WM_GETICON, 1, 0)).toBe(set.big ?? null);
	} finally {
		user32.symbols.DestroyWindow(window);
	}
});
