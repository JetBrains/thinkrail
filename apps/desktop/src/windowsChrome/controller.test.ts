import { ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WINDOWS_CHROME_SOURCE } from "../windowChrome";
import { isWindowsChromeAppearance } from "./controller";
import * as windowsChrome from "./index";

const sourcePath = resolve(import.meta.dir, WINDOWS_CHROME_SOURCE);

test("the barrel exposes construction, not native symbols or platform policy", () => {
	expect(Object.keys(windowsChrome)).toEqual(["createWindowsChrome"]);
});

test("appearance accepts only integral RGB or null and a native dark boolean", () => {
	for (const backgroundColor of [null, 0, 0x123456, 0xffffff]) {
		for (const dark of [false, true]) {
			expect(isWindowsChromeAppearance({ backgroundColor, dark })).toBe(true);
		}
	}
	for (const value of [
		null,
		undefined,
		[],
		"dark",
		{},
		{ backgroundColor: 0 },
		{ dark: true },
		{ backgroundColor: "#123456", dark: true },
		{ backgroundColor: 0, dark: 1 },
		{ backgroundColor: 0, dark: "dark" },
		{ backgroundColor: -1, dark: false },
		{ backgroundColor: 0x1000000, dark: false },
		{ backgroundColor: 0xffffffff, dark: false },
		{ backgroundColor: 0.5, dark: false },
		{ backgroundColor: Number.NaN, dark: false },
		{ backgroundColor: Number.POSITIVE_INFINITY, dark: false },
	]) {
		expect(isWindowsChromeAppearance(value)).toBe(false);
	}
});

test("the existing pre-build consumes the pure filename seam without importing FFI", async () => {
	expect(WINDOWS_CHROME_SOURCE).toBe("windows-window-chrome.c");
	expect(existsSync(sourcePath)).toBe(true);
	const build = await Bun.build({
		entrypoints: [resolve(import.meta.dir, "..", "..", "preBuild.ts")],
		target: "node",
		packages: "external",
	});
	expect(build.success).toBe(true);
	expect(build.outputs).toHaveLength(1);
	const output = await build.outputs[0]?.text();
	expect(output).toContain(WINDOWS_CHROME_SOURCE);
	expect(output).not.toContain("bun:ffi");
});

test.skipIf(process.platform === "win32" && process.arch === "x64")(
	"construction rejects other targets instead of selecting a fallback",
	() => {
		expect(() =>
			windowsChrome.createWindowsChrome(ptr(new Uint8Array(8)), "missing-source.c"),
		).toThrow("requires win32-x64");
	},
);

test.skipIf(process.platform !== "win32" || process.arch !== "x64")(
	"public construction rejects a non-window pointer without creating a window",
	() => {
		expect(() => windowsChrome.createWindowsChrome(ptr(new Uint8Array(8)), sourcePath)).toThrow(
			"could not own the window",
		);
	},
);
