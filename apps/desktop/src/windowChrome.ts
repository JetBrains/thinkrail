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
}>;

export const INITIAL_WINDOW_CHROME_GLOBAL = "__THINKRAIL_INITIAL_WINDOW_CHROME__";
export const WINDOWS_CHROME_SOURCE = "windows-window-chrome.c";
export const MAX_WINDOW_CHROME_INSET = 512;
const NO_INSETS: WindowChromeGeometry = { insetLeft: 0, insetRight: 0 };

export function desktopWindowChrome(
	platform: NodeJS.Platform,
	windowsProbe = false,
): WindowChromePolicy {
	if (platform === "darwin") {
		return {
			titleBarStyle: "hiddenInset",
			trafficLightOffset: { x: 0, y: 4 },
			geometry: { insetLeft: 64, insetRight: 0 },
			dragRegion: true,
		};
	}
	return {
		titleBarStyle: platform === "win32" && windowsProbe ? "hiddenInset" : "default",
		trafficLightOffset: null,
		geometry: NO_INSETS,
		dragRegion: platform === "win32" && windowsProbe,
	};
}

export function windowChromeGeometry(
	policy: WindowChromePolicy,
	fullScreen: boolean,
): WindowChromeGeometry {
	return fullScreen ? NO_INSETS : policy.geometry;
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
	const insetLeft: unknown = Reflect.get(payload, "insetLeft");
	const insetRight: unknown = Reflect.get(payload, "insetRight");
	return isWindowChromeInset(insetLeft) && isWindowChromeInset(insetRight)
		? { insetLeft, insetRight }
		: null;
}

export function injectInitialWindowChrome(
	preloadSource: string,
	geometry: WindowChromeGeometry,
	nativeAppearance = false,
	dragRegion = false,
): string {
	return prependPreloadGlobal(preloadSource, INITIAL_WINDOW_CHROME_GLOBAL, {
		...geometry,
		nativeAppearance,
		dragRegion,
	});
}

export function createWindowChromeStyleWriter(
	getStyle: () => Pick<CSSStyleDeclaration, "setProperty"> | null,
) {
	let geometry: WindowChromeGeometry | null = null;
	let dragRegion: boolean | null = null;
	const flush = () => {
		const style = getStyle();
		if (!style || !geometry) return;
		style.setProperty("--window-chrome-inset-left", `${geometry.insetLeft}px`);
		style.setProperty("--window-chrome-inset-right", `${geometry.insetRight}px`);
		if (dragRegion !== null) {
			style.setProperty("--window-chrome-drag-region", dragRegion ? "drag" : "no-drag");
		}
	};
	return {
		flush,
		update(payload: unknown): void {
			const next = readWindowChromeGeometry(payload);
			if (!next) return;
			geometry = next;
			if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
				const nextDragRegion: unknown = Reflect.get(payload, "dragRegion");
				if (typeof nextDragRegion === "boolean") dragRegion = nextDragRegion;
			}
			flush();
		},
	};
}

export function installWindowChromeGeometry(
	window: {
		on(name: "resize", listener: () => void): void;
		webview: { on(name: "dom-ready", listener: () => void): void };
	},
	readGeometry: () => WindowChromeGeometry | null,
	publish: (geometry: WindowChromeGeometry) => void,
): void {
	const update = () => {
		const geometry = readGeometry();
		if (geometry) publish(geometry);
	};
	window.on("resize", update);
	window.webview.on("dom-ready", update);
}
