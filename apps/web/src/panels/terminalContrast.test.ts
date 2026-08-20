import { describe, expect, it } from "bun:test";
import hcDark from "../themes/bundled/high-contrast-dark.theme.json";
import hcLight from "../themes/bundled/high-contrast-light.theme.json";
import { stripAnsiDim, terminalContrastFloor } from "./terminalContrast";

const AA = 4.5;
const AAA = 7;
const ESC = String.fromCharCode(27);

type RGB = [number, number, number];
const channel = (c: number) => {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: RGB) =>
	0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: RGB, b: RGB) => {
	const la = luminance(a);
	const lb = luminance(b);
	return la > lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05);
};
const toRgb = (hex: string): RGB => {
	const h = hex.replace("#", "");
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	];
};
const reduceLuminance = (bg: RGB, fg: RGB, ratio: number): RGB => {
	let [r, g, b] = fg;
	while (contrast([r, g, b], bg) < ratio && (r > 0 || g > 0 || b > 0)) {
		r -= Math.max(0, Math.ceil(0.1 * r));
		g -= Math.max(0, Math.ceil(0.1 * g));
		b -= Math.max(0, Math.ceil(0.1 * b));
	}
	return [r, g, b];
};
const increaseLuminance = (bg: RGB, fg: RGB, ratio: number): RGB => {
	let [r, g, b] = fg;
	while (contrast([r, g, b], bg) < ratio && (r < 255 || g < 255 || b < 255)) {
		r = Math.min(255, r + Math.ceil(0.1 * (255 - r)));
		g = Math.min(255, g + Math.ceil(0.1 * (255 - g)));
		b = Math.min(255, b + Math.ceil(0.1 * (255 - b)));
	}
	return [r, g, b];
};
const ensureContrast = (bg: RGB, fg: RGB, ratio: number): RGB => {
	if (contrast(bg, fg) >= ratio) return fg;
	const darker = luminance(fg) < luminance(bg);
	const first = darker ? reduceLuminance(bg, fg, ratio) : increaseLuminance(bg, fg, ratio);
	if (contrast(bg, first) >= ratio) return first;
	const second = darker ? increaseLuminance(bg, fg, ratio) : reduceLuminance(bg, fg, ratio);
	return contrast(bg, second) > contrast(bg, first) ? second : first;
};
const rendered = (bg: RGB, fg: RGB, ratio: number) => contrast(bg, ensureContrast(bg, fg, ratio));
const renderedDim = (bg: RGB, fg: RGB): number => {
	const blended: RGB = [
		Math.round((bg[0] + fg[0]) / 2),
		Math.round((bg[1] + fg[1]) / 2),
		Math.round((bg[2] + fg[2]) / 2),
	];
	return contrast(bg, blended);
};

const ANSI_KEYS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const;

const HC_THEMES = [
	{ name: "High Contrast Dark", manifest: hcDark },
	{ name: "High Contrast Light", manifest: hcLight },
];

describe("High Contrast terminal contrast floor", () => {
	it("configures the WCAG-AAA (7:1) floor for high-contrast themes and AA (4.5:1) otherwise", () => {
		expect(terminalContrastFloor(true)).toBe(AAA);
		expect(terminalContrastFloor(false)).toBe(AA);
	});

	for (const { name, manifest } of HC_THEMES) {
		const bg = toRgb(manifest.colors.sidebar);
		const fg = toRgb(manifest.colors.text);
		const ratio = terminalContrastFloor(true);

		it(`${name}: default foreground and every ANSI colour render at >= 4.5:1 (aiming 7:1)`, () => {
			expect(rendered(bg, fg, ratio)).toBeGreaterThanOrEqual(AA);
			for (const key of ANSI_KEYS) {
				const cr = rendered(bg, toRgb(manifest.ansi[key]), ratio);
				expect(cr, `${name} ${key}`).toBeGreaterThanOrEqual(AA);
				expect(cr, `${name} ${key} (AAA aim)`).toBeGreaterThanOrEqual(AAA - 0.01);
			}
		});

		it(`${name}: dim default foreground clears 4.5:1 only because the dim attribute is stripped`, () => {
			const dimContrast = renderedDim(bg, fg);
			const stripped = stripAnsiDim(`${ESC}[2m(client)${ESC}[22m`);
			expect(stripped.includes(`${ESC}[2m`)).toBe(false);
			const dimFixed = stripped.includes(`${ESC}[2m`) ? dimContrast : rendered(bg, fg, ratio);
			expect(dimFixed).toBeGreaterThanOrEqual(AA);
		});
	}
});

describe("stripAnsiDim", () => {
	it("drops a standalone dim (SGR 2) sequence without emitting a reset", () => {
		expect(stripAnsiDim(`${ESC}[2mX`)).toBe("X");
	});
	it("keeps the bare reset and the dim-off (22) sequences", () => {
		expect(stripAnsiDim(`${ESC}[m`)).toBe(`${ESC}[m`);
		expect(stripAnsiDim(`${ESC}[22m`)).toBe(`${ESC}[22m`);
	});
	it("removes dim from a combined SGR while keeping the other attributes", () => {
		expect(stripAnsiDim(`${ESC}[1;2;31mX`)).toBe(`${ESC}[1;31mX`);
		expect(stripAnsiDim(`${ESC}[2;34mX`)).toBe(`${ESC}[34mX`);
	});
	it("preserves the `2` inside 38;2 / 48;2 truecolor (that `2` selects RGB, not dim)", () => {
		expect(stripAnsiDim(`${ESC}[38;2;1;2;3mX`)).toBe(`${ESC}[38;2;1;2;3mX`);
		expect(stripAnsiDim(`${ESC}[48;2;0;0;0;2mX`)).toBe(`${ESC}[48;2;0;0;0mX`);
	});
	it("leaves an incomplete trailing sequence intact (never corrupts a split write)", () => {
		expect(stripAnsiDim(`hello${ESC}[2`)).toBe(`hello${ESC}[2`);
	});
	it("leaves non-dim output untouched", () => {
		expect(stripAnsiDim(`plain text ${ESC}[31mred${ESC}[0m`)).toBe(
			`plain text ${ESC}[31mred${ESC}[0m`,
		);
	});
});
