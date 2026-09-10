import type { WindowsChromeAppearance } from "./windowsChrome";

export const NATIVE_WINDOW_CHROME_GLOBAL = "__THINKRAIL_NATIVE_WINDOW_CHROME__";

export function readWindowChromeAppearance(payload: unknown): WindowsChromeAppearance | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const backgroundColor: unknown = Reflect.get(payload, "backgroundColor");
	const colorScheme: unknown = Reflect.get(payload, "colorScheme");
	if (
		typeof backgroundColor !== "string" ||
		backgroundColor.length > 96 ||
		(colorScheme !== "light" && colorScheme !== "dark")
	) {
		return null;
	}
	const match = backgroundColor.match(
		/^(rgb|rgba)\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/,
	);
	if (!match || (match[1] === "rgba") !== (match[5] !== undefined)) return null;
	const red = Number(match[2]);
	const green = Number(match[3]);
	const blue = Number(match[4]);
	const alpha = match[5] === undefined ? 1 : Number(match[5]);
	if (
		![red, green, blue].every((channel) => Number.isFinite(channel) && channel <= 255) ||
		!Number.isFinite(alpha) ||
		alpha > 1
	) {
		return null;
	}
	return {
		backgroundColor:
			alpha === 1 ? (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue) : null,
		dark: colorScheme === "dark",
	};
}
