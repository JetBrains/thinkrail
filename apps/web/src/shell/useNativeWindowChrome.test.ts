import { expect, spyOn, test } from "bun:test";
import type { NativeWindowAppearance, NativeWindowChromeBridge } from "@thinkrail/contracts";
import { getNativeWindowChromeBridge, reportNativeWindowAppearance } from "./useNativeWindowChrome";

test("ordinary browsers and incomplete globals have no native appearance capability", () => {
	for (const value of [undefined, null, [], {}, { setAppearance: true }]) {
		expect(getNativeWindowChromeBridge(value)).toBeNull();
	}
	const bridge: NativeWindowChromeBridge = { setAppearance() {} };
	expect(getNativeWindowChromeBridge(bridge)).toBe(bridge);
});

test("native appearance projects computed header colors without theme ids", () => {
	const received: NativeWindowAppearance[] = [];
	const bridge: NativeWindowChromeBridge = { setAppearance: (value) => received.push(value) };
	reportNativeWindowAppearance(
		bridge,
		{ backgroundColor: "rgb(32, 32, 32)", colorScheme: "dark" },
		"light",
	);
	reportNativeWindowAppearance(
		bridge,
		{ backgroundColor: "rgb(240, 240, 240)", colorScheme: "light" },
		"dark",
	);
	expect(received).toEqual([
		{ backgroundColor: "rgb(32, 32, 32)", colorScheme: "dark" },
		{ backgroundColor: "rgb(240, 240, 240)", colorScheme: "light" },
	]);
});

test("multiple supported CSS schemes resolve against the current system appearance", () => {
	const received: NativeWindowAppearance[] = [];
	const bridge: NativeWindowChromeBridge = { setAppearance: (value) => received.push(value) };
	for (const colorScheme of ["light dark", "dark light"]) {
		for (const systemAppearance of ["light", "dark"] as const) {
			reportNativeWindowAppearance(
				bridge,
				{ backgroundColor: "rgb(240, 240, 240)", colorScheme },
				systemAppearance,
			);
		}
	}
	expect(received.map((value) => value.colorScheme)).toEqual(["light", "dark", "light", "dark"]);
});

test("unresolved document appearance is not sent to native chrome", () => {
	const received: NativeWindowAppearance[] = [];
	const bridge: NativeWindowChromeBridge = { setAppearance: (value) => received.push(value) };
	reportNativeWindowAppearance(bridge, { backgroundColor: "", colorScheme: "dark" }, "dark");
	reportNativeWindowAppearance(
		bridge,
		{ backgroundColor: "rgb(32, 32, 32)", colorScheme: "normal" },
		"dark",
	);
	expect(received).toEqual([]);
});

test("an unavailable native appearance bridge does not break the shared shell", () => {
	const warning = spyOn(console, "warn").mockImplementation(() => {});
	const error = new Error("native channel closed");
	try {
		reportNativeWindowAppearance(
			{
				setAppearance() {
					throw error;
				},
			},
			{ backgroundColor: "rgb(32, 32, 32)", colorScheme: "dark" },
			"dark",
		);
		expect(warning).toHaveBeenCalledWith("Could not update native window appearance", error);
	} finally {
		warning.mockRestore();
	}
});
