import type { NativeWindowState } from "@thinkrail/contracts";
import { prependPreloadGlobal } from "./preloadGlobals";

export type WindowChromeGeometry = Readonly<{
	insetLeft: number;
	insetRight: number;
}>;

export type WindowChromePolicy = Readonly<{
	titleBarStyle: "default" | "hiddenInset";
	trafficLightOffset: { x: number; y: number } | null;
	geometry: WindowChromeGeometry;
	dragRegion: boolean;
	windowControls: boolean;
	restoreFrameControls: boolean;
}>;

export type WindowChromePreloadSeed = Readonly<
	WindowChromeGeometry & {
		dragRegion: boolean;
		windowControls: boolean;
	}
>;

export const INITIAL_WINDOW_CHROME_GLOBAL = "__THINKRAIL_INITIAL_WINDOW_CHROME__";
export const NATIVE_WINDOW_CONTROLS_GLOBAL = "__THINKRAIL_NATIVE_WINDOW_CONTROLS__";
const WINDOW_CHROME_INSET_LEFT_PROPERTY = "--window-chrome-inset-left";
const WINDOW_CHROME_INSET_RIGHT_PROPERTY = "--window-chrome-inset-right";
const WINDOW_CHROME_DRAG_REGION_PROPERTY = "--window-chrome-drag-region";
export const MAX_WINDOW_CHROME_INSET = 512;

const NO_INSETS: WindowChromeGeometry = { insetLeft: 0, insetRight: 0 };

export function desktopWindowChrome(platform: NodeJS.Platform): WindowChromePolicy {
	if (platform === "darwin") {
		return {
			titleBarStyle: "hiddenInset",
			trafficLightOffset: { x: 0, y: 4 },
			geometry: { insetLeft: 64, insetRight: 0 },
			dragRegion: true,
			windowControls: false,
			restoreFrameControls: false,
		};
	}
	if (platform === "win32") {
		return {
			titleBarStyle: "hiddenInset",
			trafficLightOffset: null,
			geometry: { insetLeft: 0, insetRight: 138 },
			dragRegion: true,
			windowControls: true,
			restoreFrameControls: true,
		};
	}
	return {
		titleBarStyle: "default",
		trafficLightOffset: null,
		geometry: NO_INSETS,
		dragRegion: false,
		windowControls: false,
		restoreFrameControls: false,
	};
}

export function windowChromeGeometry(
	policy: WindowChromePolicy,
	fullScreen: boolean,
): WindowChromeGeometry {
	return fullScreen ? NO_INSETS : policy.geometry;
}

export function windowChromePreloadSeed(policy: WindowChromePolicy): WindowChromePreloadSeed {
	return {
		...policy.geometry,
		dragRegion: policy.dragRegion,
		windowControls: policy.windowControls,
	};
}

function isWindowChromeInset(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= MAX_WINDOW_CHROME_INSET
	);
}

export function readWindowChromeGeometry(payload: unknown): WindowChromeGeometry | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const insetLeft = Reflect.get(payload, "insetLeft");
	const insetRight = Reflect.get(payload, "insetRight");
	return isWindowChromeInset(insetLeft) && isWindowChromeInset(insetRight)
		? { insetLeft, insetRight }
		: null;
}

export function injectInitialWindowChrome(
	preloadSource: string,
	seed: WindowChromePreloadSeed,
): string {
	return prependPreloadGlobal(preloadSource, INITIAL_WINDOW_CHROME_GLOBAL, seed);
}

export function readWindowChromeFlag(
	payload: unknown,
	name: "dragRegion" | "windowControls",
): boolean | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const value = Reflect.get(payload, name);
	return typeof value === "boolean" ? value : null;
}

export function createWindowChromeStyleWriter(
	getStyle: () => Pick<CSSStyleDeclaration, "setProperty"> | null,
): { update(payload: unknown): void; flush(): void } {
	let geometry: WindowChromeGeometry | undefined;
	let dragRegion: boolean | undefined;
	const flush = () => {
		const style = getStyle();
		if (!style || !geometry) return;
		style.setProperty(WINDOW_CHROME_INSET_LEFT_PROPERTY, `${geometry.insetLeft}px`);
		style.setProperty(WINDOW_CHROME_INSET_RIGHT_PROPERTY, `${geometry.insetRight}px`);
		if (dragRegion !== undefined) {
			style.setProperty(WINDOW_CHROME_DRAG_REGION_PROPERTY, dragRegion ? "drag" : "no-drag");
		}
	};
	return {
		update(payload) {
			const nextGeometry = readWindowChromeGeometry(payload);
			if (!nextGeometry) return;
			geometry = nextGeometry;
			const nextDragRegion = readWindowChromeFlag(payload, "dragRegion");
			if (nextDragRegion !== null) dragRegion = nextDragRegion;
			flush();
		},
		flush,
	};
}

export function installWindowChromePublisher<T>(
	window: {
		on(name: "resize", listener: () => void): void;
		webview: { on(name: "dom-ready", listener: () => void): void };
	},
	read: () => T,
	publish: (value: T) => void,
	equal: (a: T, b: T) => boolean,
): void {
	let lastPublished: { value: T } | undefined;
	window.on("resize", () => {
		const next = read();
		if (lastPublished && equal(lastPublished.value, next)) return;
		lastPublished = { value: next };
		publish(next);
	});
	window.webview.on("dom-ready", () => {
		const next = read();
		lastPublished = { value: next };
		publish(next);
	});
}

export function installWindowChromeGeometry(
	window: {
		on(name: "resize", listener: () => void): void;
		webview: { on(name: "dom-ready", listener: () => void): void };
	},
	readGeometry: () => WindowChromeGeometry,
	publish: (geometry: WindowChromeGeometry) => void,
): void {
	installWindowChromePublisher(
		window,
		readGeometry,
		publish,
		(a, b) => a.insetLeft === b.insetLeft && a.insetRight === b.insetRight,
	);
}

export function readNativeWindowState(window: {
	isMaximized(): boolean;
	isFullScreen(): boolean;
}): NativeWindowState {
	return { maximized: window.isMaximized(), fullScreen: window.isFullScreen() };
}

export function sameNativeWindowState(a: NativeWindowState, b: NativeWindowState): boolean {
	return a.maximized === b.maximized && a.fullScreen === b.fullScreen;
}
