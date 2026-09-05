import { expect, test } from "bun:test";
import {
	createDesktopWindowChromeController,
	desktopWindowChromePolicy,
	linuxResizeEdgeCode,
	normalizeWindowsFrameStyle,
	preservedWindowsStyle,
	probeDesktopWindowTransitions,
	readDesktopResizeEdge,
	windowsResizeDirection,
} from "./windowChrome";

test("maps each shipped desktop OS to its native titlebar mechanism", () => {
	expect(desktopWindowChromePolicy("darwin")).toEqual({
		platform: "macos",
		titleBarStyle: "hiddenInset",
		trafficLightOffset: { x: 8, y: 10 },
	});
	expect(desktopWindowChromePolicy("win32")).toEqual({
		platform: "windows",
		titleBarStyle: "hiddenInset",
	});
	expect(desktopWindowChromePolicy("linux")).toEqual({
		platform: "linux",
		titleBarStyle: "hidden",
	});
	expect(() => desktopWindowChromePolicy("aix")).toThrow(
		"unsupported desktop chrome platform: aix",
	);
});

test("preserves the Windows resize frame, system menu, and minimize/maximize capabilities", () => {
	expect(preservedWindowsStyle(0x00c00000n)).toBe(0x00cf0000n);
	expect(preservedWindowsStyle(0x00c40000n)).toBe(0x00cf0000n);
	expect(preservedWindowsStyle(0x00cf0000n)).toBe(0x00cf0000n);
});

test("accepts only the eight compositor resize directions", () => {
	for (const edge of [
		"north-west",
		"north",
		"north-east",
		"west",
		"east",
		"south-west",
		"south",
		"south-east",
	] as const) {
		expect(readDesktopResizeEdge({ edge })).toBe(edge);
	}
	expect(readDesktopResizeEdge({ edge: "center" })).toBeNull();
	expect(readDesktopResizeEdge({ edge: 4 })).toBeNull();
	expect(readDesktopResizeEdge(null)).toBeNull();
});

test("normalizes the live Windows frame only when capabilities are missing", () => {
	let style = 0x00c40000n;
	const calls: unknown[] = [];
	const api = {
		readStyle: (handle: unknown) => {
			calls.push(["read", handle]);
			return style;
		},
		writeStyle: (handle: unknown, next: bigint) => {
			calls.push(["write", handle, next]);
			style = next;
		},
		refreshFrame: (handle: unknown) => calls.push(["refresh", handle]),
	};

	expect(normalizeWindowsFrameStyle("window", api)).toBe(true);
	expect(style).toBe(0x00cf0000n);
	expect(normalizeWindowsFrameStyle("window", api)).toBe(false);
	expect(calls).toEqual([
		["read", "window"],
		["write", "window", 0x00cf0000n],
		["refresh", "window"],
		["read", "window"],
	]);
});

test("maps web resize directions to Windows system resize directions", () => {
	expect(
		["north-west", "north", "north-east", "west", "east", "south-west", "south", "south-east"].map(
			(edge) => windowsResizeDirection(edge),
		),
	).toEqual([4, 3, 5, 1, 2, 7, 6, 8]);
	expect(() => windowsResizeDirection("center")).toThrow("unsupported resize edge: center");
});

test("maps web resize directions to GTK's native edge enum", () => {
	expect(
		["north-west", "north", "north-east", "west", "east", "south-west", "south", "south-east"].map(
			(edge) => linuxResizeEdgeCode(edge),
		),
	).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
	expect(() => linuxResizeEdgeCode("center")).toThrow("unsupported resize edge: center");
});

test("native transition probe exercises maximize, restore, minimize, and unminimize", async () => {
	let maximized = false;
	let minimized = false;
	const calls: string[] = [];
	const window = {
		minimize: () => {
			calls.push("minimize");
			minimized = true;
		},
		maximize: () => {
			calls.push("maximize");
			maximized = true;
		},
		unmaximize: () => {
			calls.push("restore");
			maximized = false;
		},
		isMaximized: () => maximized,
		isMinimized: () => minimized,
		unminimize: () => {
			calls.push("unminimize");
			minimized = false;
		},
		requestClose: () => calls.push("request-close"),
	};
	const controller = createDesktopWindowChromeController({
		platform: "windows",
		window,
		onState: () => {},
		startNativeResize: () => {},
	});

	expect(await probeDesktopWindowTransitions(controller, window)).toEqual({
		maximized: true,
		restored: true,
		minimized: true,
		unminimized: true,
	});
	expect(calls).toEqual(["maximize", "restore", "minimize", "unminimize"]);
});

test("window chrome actions preserve native state and graceful close", () => {
	let maximized = false;
	const calls: string[] = [];
	const snapshots: boolean[] = [];
	const resized: string[] = [];
	const window = {
		minimize: () => calls.push("minimize"),
		maximize: () => {
			calls.push("maximize");
			maximized = true;
		},
		unmaximize: () => {
			calls.push("restore");
			maximized = false;
		},
		isMaximized: () => maximized,
		requestClose: () => calls.push("request-close"),
	};
	const linux = createDesktopWindowChromeController({
		platform: "linux",
		window,
		onState: ({ maximized }) => snapshots.push(maximized),
		startNativeResize: (edge) => resized.push(edge),
	});

	expect(linux.getSnapshot()).toEqual({ maximized: false });
	linux.minimize();
	linux.toggleMaximize();
	linux.publishState();
	linux.toggleMaximize();
	linux.requestClose();
	expect(linux.startResize("south-east")).toBe(true);
	expect(calls).toEqual(["minimize", "maximize", "restore", "request-close"]);
	expect(snapshots).toEqual([true, true, false]);
	expect(resized).toEqual(["south-east"]);

	const windowsResized: string[] = [];
	const windows = createDesktopWindowChromeController({
		platform: "windows",
		window,
		onState: () => {},
		startNativeResize: (edge) => windowsResized.push(edge),
	});
	expect(windows.startResize("east")).toBe(true);
	expect(windowsResized).toEqual(["east"]);
});
