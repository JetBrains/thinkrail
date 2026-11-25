export const HARMONIES = [
	"analogous",
	"monochromatic",
	"complementary",
	"split-complementary",
	"triadic",
	"tetradic",
] as const;

export type Harmony = (typeof HARMONIES)[number];

export type Rating = "AAA" | "AA" | "AA large" | "fail";

export interface Contrast {
	text: "white" | "black";
	ratio: number;
	rating: Rating;
}

export interface Swatch {
	hex: string;
	role: string;
	contrast?: Contrast;
}

export interface Palette {
	base: string;
	harmony: Harmony;
	colors: Swatch[];
	contrastChecked: boolean;
}

interface Hsl {
	h: number;
	s: number;
	l: number;
}

type Step = [role: string, hue: number, lightness: number];

const STEPS: Record<Harmony, Step[]> = {
	analogous: [
		["base", 0, 0],
		["neighbour −30°", -30, 0],
		["neighbour −15°", -15, 0],
		["neighbour +15°", 15, 0],
		["neighbour +30°", 30, 0],
	],
	monochromatic: [
		["darkest", 0, -30],
		["darker", 0, -15],
		["base", 0, 0],
		["lighter", 0, 15],
		["lightest", 0, 30],
	],
	complementary: [
		["base", 0, 0],
		["base tint", 0, 20],
		["complement", 180, 0],
		["complement tint", 180, 20],
		["complement shade", 180, -20],
	],
	"split-complementary": [
		["base", 0, 0],
		["split −150°", 150, 0],
		["split +150°", 210, 0],
		["split −150° tint", 150, 20],
		["split +150° tint", 210, 20],
	],
	triadic: [
		["base", 0, 0],
		["triad +120°", 120, 0],
		["triad +240°", 240, 0],
		["triad +120° tint", 120, 20],
		["triad +240° tint", 240, 20],
	],
	tetradic: [
		["base", 0, 0],
		["square +90°", 90, 0],
		["square +180°", 180, 0],
		["square +270°", 270, 0],
		["base tint", 0, 20],
	],
};

export function parseHex(value: string): [number, number, number] {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
	if (!match) throw new Error(`"${value}" is not a hex colour such as #3b82f6 or #38f.`);
	const digits = match[1] as string;
	const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
	return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as [
		number,
		number,
		number,
	];
}

function toHex(rgb: [number, number, number]): string {
	return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function toHsl([r, g, b]: [number, number, number]): Hsl {
	const [red, green, blue] = [r / 255, g / 255, b / 255];
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l: l * 100 };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h =
		max === red
			? (green - blue) / d + (green < blue ? 6 : 0)
			: max === green
				? (blue - red) / d + 2
				: (red - green) / d + 4;
	return { h: h * 60, s: s * 100, l: l * 100 };
}

function toRgb({ h, s, l }: Hsl): [number, number, number] {
	const saturation = s / 100;
	const lightness = l / 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = saturation * Math.min(lightness, 1 - lightness);
	const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function luminance(rgb: [number, number, number]): number {
	const [r, g, b] = rgb.map((channel) => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(hex: string): Contrast {
	const l = luminance(parseHex(hex));
	const white = 1.05 / (l + 0.05);
	const black = (l + 0.05) / 0.05;
	const ratio = Math.round(Math.max(white, black) * 100) / 100;
	const rating: Rating =
		ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fail";
	return { text: white >= black ? "white" : "black", ratio, rating };
}

export function buildPalette(base: string, harmony: Harmony, checkContrast: boolean): Palette {
	const rgb = parseHex(base);
	const origin = toHsl(rgb);
	const colors = STEPS[harmony].map(([role, hue, lightness]): Swatch => {
		const hex =
			hue === 0 && lightness === 0
				? toHex(rgb)
				: toHex(
						toRgb({
							h: (((origin.h + hue) % 360) + 360) % 360,
							s: origin.s,
							l: Math.min(95, Math.max(5, origin.l + lightness)),
						}),
					);
		return checkContrast ? { hex, role, contrast: contrast(hex) } : { hex, role };
	});
	return { base: toHex(rgb), harmony, colors, contrastChecked: checkContrast };
}

export function paletteText(palette: Palette): string {
	const lines = palette.colors.map((color, index) => {
		const rating = color.contrast
			? ` — ${color.contrast.text} text ${color.contrast.ratio}:1 (${color.contrast.rating})`
			: "";
		return `${index + 1}. ${color.hex} ${color.role}${rating}`;
	});
	const css = palette.colors.map((color, index) => `  --palette-${index + 1}: ${color.hex};`);
	return [
		`${palette.harmony} palette from ${palette.base}:`,
		...lines,
		"",
		"CSS:",
		":root {",
		...css,
		"}",
	].join("\n");
}
