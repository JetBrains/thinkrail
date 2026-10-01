import type { Pointer } from "bun:ffi";
import { expect, test } from "bun:test";
import {
	loadWindowsFrameApi,
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

function fakeFrameApi(
	initialStyle: bigint,
	options: { applies?: boolean; refreshes?: boolean } = {},
) {
	let style = initialStyle;
	const calls: Array<string | bigint> = [];
	return {
		calls,
		api: {
			getStyle: () => style,
			setStyle: (_window: Pointer, next: bigint) => {
				calls.push(next);
				if (options.applies ?? true) style = next;
			},
			refreshFrame: () => {
				calls.push("refresh");
				return options.refreshes ?? true;
			},
		},
	};
}

test("does not refresh an already complete frame style", () => {
	const { api, calls } = fakeFrameApi(frameControlBits);
	expect(restoreWindowsFrameControls(windowHandle, api)).toBe(false);
	expect(calls).toEqual([]);
});

test("updates and refreshes an incomplete frame style", () => {
	const { api, calls } = fakeFrameApi(0x16c40000n);
	expect(restoreWindowsFrameControls(windowHandle, api)).toBe(true);
	expect(calls).toEqual([0x16cf0000n, "refresh"]);
});

test("treats a zero previous style as success when the bits land", () => {
	const { api, calls } = fakeFrameApi(0n);
	expect(restoreWindowsFrameControls(windowHandle, api)).toBe(true);
	expect(calls).toEqual([frameControlBits, "refresh"]);
});

test("throws when the frame style bits do not land", () => {
	const { api, calls } = fakeFrameApi(0x16c40000n, { applies: false });
	expect(() => restoreWindowsFrameControls(windowHandle, api)).toThrow(
		"Could not update the Windows window style",
	);
	expect(calls).toEqual([0x16cf0000n]);
});

test("throws when refreshing the frame fails", () => {
	const { api } = fakeFrameApi(0n, { refreshes: false });
	expect(() => restoreWindowsFrameControls(windowHandle, api)).toThrow(
		"Could not refresh the Windows window frame",
	);
});

test.skipIf(process.platform !== "win32")("binds the user32 symbols behind the frame api", () => {
	const api = loadWindowsFrameApi();
	expect(loadWindowsFrameApi()).toBe(api);
	expect(api.getStyle(0 as unknown as Pointer)).toBe(0n);
	api.setStyle(0 as unknown as Pointer, 0n);
	expect(api.refreshFrame(0 as unknown as Pointer)).toBe(false);
});
