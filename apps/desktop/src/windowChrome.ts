import { prependPreloadGlobal } from "./preloadGlobals";

export type WindowChromeGeometry = {
	insetLeft: number;
	insetRight: number;
};

export type WindowChromePolicy = {
	titleBarStyle: "default" | "hiddenInset";
	trafficLightOffset: { x: number; y: number } | null;
	geometry: WindowChromeGeometry;
};

export const INITIAL_WINDOW_CHROME_GLOBAL = "__THINKRAIL_INITIAL_WINDOW_CHROME__";
export const WINDOW_CHROME_INSET_LEFT_PROPERTY = "--window-chrome-inset-left";
export const WINDOW_CHROME_INSET_RIGHT_PROPERTY = "--window-chrome-inset-right";
export const MAX_WINDOW_CHROME_INSET = 512;

const NO_INSETS: WindowChromeGeometry = { insetLeft: 0, insetRight: 0 };

export function desktopWindowChrome(platform: NodeJS.Platform): WindowChromePolicy {
	if (platform === "darwin") {
		return {
			titleBarStyle: "hiddenInset",
			trafficLightOffset: { x: 0, y: 4 },
			geometry: { insetLeft: 64, insetRight: 0 },
		};
	}
	return { titleBarStyle: "default", trafficLightOffset: null, geometry: NO_INSETS };
}

export function windowChromeGeometry(
	policy: WindowChromePolicy,
	fullScreen: boolean,
): WindowChromeGeometry {
	return fullScreen ? { ...policy.geometry, insetLeft: 0 } : policy.geometry;
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
): string {
	return prependPreloadGlobal(preloadSource, INITIAL_WINDOW_CHROME_GLOBAL, geometry);
}

export function windowChromeCssDeclarations(
	geometry: WindowChromeGeometry,
): ReadonlyArray<readonly [property: string, value: string]> {
	return [
		[WINDOW_CHROME_INSET_LEFT_PROPERTY, `${geometry.insetLeft}px`],
		[WINDOW_CHROME_INSET_RIGHT_PROPERTY, `${geometry.insetRight}px`],
	];
}
