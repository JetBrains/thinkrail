export type DesktopResizeEdge =
	| "north-west"
	| "north"
	| "north-east"
	| "west"
	| "east"
	| "south-west"
	| "south"
	| "south-east";

export type DesktopWindowChromePlatform = "macos" | "windows" | "linux";

export type DesktopWindowChromePolicy = {
	platform: DesktopWindowChromePlatform;
	titleBarStyle: "default" | "hidden" | "hiddenInset";
	trafficLightOffset?: { x: number; y: number };
};

export interface DesktopWindowChromeHandle {
	minimize(): unknown;
	maximize(): unknown;
	unmaximize(): unknown;
	isMaximized(): boolean;
	requestClose(): unknown;
}

export interface DesktopWindowTransitionHandle {
	isMaximized(): boolean;
	isMinimized(): boolean;
	unminimize(): unknown;
}

export type DesktopWindowTransitionProbe = {
	maximized: true;
	restored: true;
	minimized: true;
	unminimized: true;
};

export interface DesktopWindowChromeController {
	getSnapshot(): { maximized: boolean };
	publishState(): void;
	minimize(): void;
	toggleMaximize(): void;
	requestClose(): void;
	startResize(edge: DesktopResizeEdge): boolean;
}

const RESIZE_EDGES = new Set<DesktopResizeEdge>([
	"north-west",
	"north",
	"north-east",
	"west",
	"east",
	"south-west",
	"south",
	"south-east",
]);

export function desktopWindowChromePolicy(platform: NodeJS.Platform): DesktopWindowChromePolicy {
	if (platform === "darwin") {
		return {
			platform: "macos",
			titleBarStyle: "hiddenInset",
			trafficLightOffset: { x: 8, y: 10 },
		};
	}
	if (platform === "win32") {
		return { platform: "windows", titleBarStyle: "hiddenInset" };
	}
	if (platform === "linux") {
		return { platform: "linux", titleBarStyle: "hidden" };
	}
	throw new Error(`unsupported desktop chrome platform: ${platform}`);
}

export function preservedWindowsStyle(style: bigint): bigint {
	return style | 0x000f0000n;
}

export function normalizeWindowsFrameStyle(
	handle: unknown,
	api: {
		readStyle(handle: unknown): bigint;
		writeStyle(handle: unknown, style: bigint): void;
		refreshFrame(handle: unknown): void;
	},
): boolean {
	const current = api.readStyle(handle);
	const next = preservedWindowsStyle(current);
	if (next === current) return false;
	api.writeStyle(handle, next);
	api.refreshFrame(handle);
	return true;
}

export function windowsResizeDirection(edge: string): number {
	switch (edge) {
		case "north-west":
			return 4;
		case "north":
			return 3;
		case "north-east":
			return 5;
		case "west":
			return 1;
		case "east":
			return 2;
		case "south-west":
			return 7;
		case "south":
			return 6;
		case "south-east":
			return 8;
		default:
			throw new Error(`unsupported resize edge: ${edge}`);
	}
}

export function linuxResizeEdgeCode(edge: string): number {
	switch (edge) {
		case "north-west":
			return 0;
		case "north":
			return 1;
		case "north-east":
			return 2;
		case "west":
			return 3;
		case "east":
			return 4;
		case "south-west":
			return 5;
		case "south":
			return 6;
		case "south-east":
			return 7;
		default:
			throw new Error(`unsupported resize edge: ${edge}`);
	}
}

export function readDesktopResizeEdge(payload: unknown): DesktopResizeEdge | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const edge = Reflect.get(payload, "edge");
	return typeof edge === "string" && RESIZE_EDGES.has(edge as DesktopResizeEdge)
		? (edge as DesktopResizeEdge)
		: null;
}

async function waitForWindowState(
	read: () => boolean,
	expected: boolean,
	label: string,
): Promise<void> {
	const deadline = performance.now() + 5_000;
	while (read() !== expected) {
		if (performance.now() >= deadline) throw new Error(`window did not become ${label}`);
		await Bun.sleep(25);
	}
}

export async function probeDesktopWindowTransitions(
	controller: DesktopWindowChromeController,
	window: DesktopWindowTransitionHandle,
): Promise<DesktopWindowTransitionProbe> {
	if (window.isMinimized()) {
		window.unminimize();
		await waitForWindowState(() => window.isMinimized(), false, "unminimized");
	}
	if (window.isMaximized()) {
		controller.toggleMaximize();
		await waitForWindowState(() => window.isMaximized(), false, "restored");
	}
	controller.toggleMaximize();
	await waitForWindowState(() => window.isMaximized(), true, "maximized");
	controller.toggleMaximize();
	await waitForWindowState(() => window.isMaximized(), false, "restored");
	controller.minimize();
	await waitForWindowState(() => window.isMinimized(), true, "minimized");
	window.unminimize();
	await waitForWindowState(() => window.isMinimized(), false, "unminimized");
	return { maximized: true, restored: true, minimized: true, unminimized: true };
}

export function createDesktopWindowChromeController({
	platform,
	window,
	onState,
	startNativeResize,
}: {
	platform: DesktopWindowChromePlatform;
	window: DesktopWindowChromeHandle;
	onState(snapshot: { maximized: boolean }): void;
	startNativeResize(edge: DesktopResizeEdge): void;
}): DesktopWindowChromeController {
	const getSnapshot = () => ({ maximized: window.isMaximized() });
	const publishState = () => onState(getSnapshot());
	return {
		getSnapshot,
		publishState,
		minimize: () => {
			window.minimize();
		},
		toggleMaximize: () => {
			if (window.isMaximized()) window.unmaximize();
			else window.maximize();
			publishState();
		},
		requestClose: () => {
			window.requestClose();
		},
		startResize: (edge) => {
			if (platform === "macos") return false;
			startNativeResize(edge);
			return true;
		},
	};
}
