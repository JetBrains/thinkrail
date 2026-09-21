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
		};
	}
	return {
		titleBarStyle: "default",
		trafficLightOffset: null,
		geometry: NO_INSETS,
		dragRegion: false,
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
	const insetLeft = Reflect.get(payload, "insetLeft");
	const insetRight = Reflect.get(payload, "insetRight");
	return isWindowChromeInset(insetLeft) && isWindowChromeInset(insetRight)
		? { insetLeft, insetRight }
		: null;
}

export function injectInitialWindowChrome(
	preloadSource: string,
	geometry: WindowChromeGeometry,
	dragRegion: boolean,
): string {
	return prependPreloadGlobal(preloadSource, INITIAL_WINDOW_CHROME_GLOBAL, {
		...geometry,
		dragRegion,
	});
}

export function readWindowChromeDragRegion(payload: unknown): boolean | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const dragRegion = Reflect.get(payload, "dragRegion");
	return typeof dragRegion === "boolean" ? dragRegion : null;
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
			const nextDragRegion = readWindowChromeDragRegion(payload);
			if (nextDragRegion !== null) dragRegion = nextDragRegion;
			flush();
		},
		flush,
	};
}

export function installWindowChromeGeometry(
	window: {
		on(name: "resize", listener: () => void): void;
		webview: { on(name: "dom-ready", listener: () => void): void };
	},
	readGeometry: () => WindowChromeGeometry,
	publish: (geometry: WindowChromeGeometry) => void,
): void {
	let lastPublished: WindowChromeGeometry | undefined;
	window.on("resize", () => {
		const geometry = readGeometry();
		if (
			lastPublished &&
			lastPublished.insetLeft === geometry.insetLeft &&
			lastPublished.insetRight === geometry.insetRight
		) {
			return;
		}
		lastPublished = geometry;
		publish(geometry);
	});
	window.webview.on("dom-ready", () => {
		const geometry = readGeometry();
		lastPublished = geometry;
		publish(geometry);
	});
}
