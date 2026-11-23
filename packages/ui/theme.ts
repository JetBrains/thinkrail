export function onThemeSwap(onSwap: () => void): () => void {
	const observer = new MutationObserver(onSwap);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
}

let colorCanvas: CanvasRenderingContext2D | null | undefined;

function canvasNormalize(color: string): string {
	if (typeof document === "undefined") return "";
	colorCanvas ??= document.createElement("canvas").getContext("2d");
	if (!colorCanvas) return "";
	colorCanvas.fillStyle = "#000000";
	colorCanvas.fillStyle = color;
	const first = colorCanvas.fillStyle;
	colorCanvas.fillStyle = "#ffffff";
	colorCanvas.fillStyle = color;
	return first === colorCanvas.fillStyle ? first : "";
}

function srgbColorToHex(color: string): string {
	const component = "([+-]?(?:\\d*\\.)?\\d+(?:e[+-]?\\d+)?%?)";
	const match = new RegExp(
		`^color\\(srgb\\s+${component}\\s+${component}\\s+${component}(?:\\s*\\/\\s*${component})?\\)$`,
		"i",
	).exec(color);
	if (!match) return "";
	const fraction = (value: string | undefined, fallback: number): number => {
		if (value === undefined) return fallback;
		return value.endsWith("%") ? Number.parseFloat(value) / 100 : Number(value);
	};
	const values = [
		fraction(match[1], 0),
		fraction(match[2], 0),
		fraction(match[3], 0),
		fraction(match[4], 1),
	];
	if (values.some((value) => !Number.isFinite(value))) return "";
	const channels = values.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255));
	if (match[4] === undefined) channels.pop();
	return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function cssColorToHex(color: string): string {
	const value = color.trim();
	const short = /^#([0-9a-f]{3,4})$/i.exec(value)?.[1];
	if (short) return `#${[...short].map((c) => c + c).join("")}`;
	if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
	const directSrgb = srgbColorToHex(value);
	if (directSrgb) return directSrgb;
	const parsed = canvasNormalize(value);
	if (parsed.startsWith("#")) return parsed;
	const parsedSrgb = srgbColorToHex(parsed);
	if (parsedSrgb) return parsedSrgb;
	const [, r, g, b, a] = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(parsed) ?? [];
	const channels = [Number(r), Number(g), Number(b), Math.round(Number(a) * 255)];
	if (channels.some((c) => !Number.isFinite(c))) return "";
	return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
