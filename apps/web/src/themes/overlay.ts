import {
	type ExtThemeOverlay,
	type ExtThemePreviewResult,
	extThemeTokensErrors,
	isExtThemeMode,
	isExtThemeToken,
} from "@thinkrail/contracts";

export interface ThemeOverlay extends ExtThemeOverlay {
	readonly key: string;
}

export type ThemeOverlayResult = ExtThemePreviewResult;

const MIN_CONTRAST = 3;

export const overlayErrors = (overlay: ThemeOverlay) => [
	...(isExtThemeMode(overlay.mode) ? [] : [`mode "${String(overlay.mode)}" unknown`]),
	...extThemeTokensErrors(overlay.tokens).map(({ token, error }) => `${token}: ${error}`),
];

export const parseThemeOverlay = (value: unknown): ThemeOverlay | null => {
	if (typeof value !== "object" || value === null) return null;
	const key = Reflect.get(value, "key");
	const mode = Reflect.get(value, "mode");
	const tokens = Reflect.get(value, "tokens");
	if (typeof key !== "string" || key === "" || !isExtThemeMode(mode)) return null;
	if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) return null;
	const entries = Object.entries(tokens);
	if (entries.some(([token]) => !isExtThemeToken(token))) return null;
	const overlay = { key, mode, tokens: Object.fromEntries(entries) };
	return overlayErrors(overlay).length === 0 ? overlay : null;
};

type Rgba = readonly [number, number, number, number];

const parses = (context: CanvasRenderingContext2D, color: string) => {
	context.fillStyle = "black";
	context.fillStyle = color;
	const first = context.fillStyle;
	context.fillStyle = "white";
	context.fillStyle = color;
	return first === context.fillStyle;
};

const rgbaOf = (context: CanvasRenderingContext2D, color: string): Rgba | null => {
	if (!parses(context, color)) return null;
	context.clearRect(0, 0, 1, 1);
	context.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
	return [r, g, b, a / 255];
};

const channel = (value: number) => {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgba) =>
	0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const over = (top: Rgba, bottom: Rgba): Rgba => {
	const a = top[3];
	return [
		top[0] * a + bottom[0] * (1 - a),
		top[1] * a + bottom[1] * (1 - a),
		top[2] * a + bottom[2] * (1 - a),
		1,
	];
};

const contrast = (a: Rgba, b: Rgba) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

export const readTextContrast = (root: HTMLElement) => {
	const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!context) return null;
	const probe = document.createElement("span");
	probe.style.setProperty("color", "var(--text-default)");
	probe.style.setProperty("background-color", "var(--container-workspace-bg)");
	root.append(probe);
	const style = getComputedStyle(probe);
	const text = rgbaOf(context, style.color);
	const background = rgbaOf(context, style.backgroundColor);
	probe.remove();
	if (!text || !background) return null;
	const opaque = over(background, [255, 255, 255, 1]);
	return contrast(over(text, opaque), opaque);
};

export const readabilityError = (root: HTMLElement) => {
	const ratio = readTextContrast(root);
	return ratio !== null && ratio < MIN_CONTRAST
		? `text contrast ${ratio.toFixed(2)}:1 on the workspace background is below ${MIN_CONTRAST}:1`
		: undefined;
};
