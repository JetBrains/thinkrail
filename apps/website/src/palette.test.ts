import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function themeVars(selector: string): Record<string, string> {
	const start = CSS.indexOf(`${selector} {`);
	if (start < 0) throw new Error(`no ${selector} block in styles.css`);
	const block = CSS.slice(start, CSS.indexOf("\n}", start));
	return Object.fromEntries(
		[...block.matchAll(/^\t(--[a-z-]+):\s*([^;]+);/gm)].map((m) => [
			m[1] as string,
			m[2] as string,
		]),
	);
}

const DARK = themeVars(":root");
const THEMES = {
	dark: DARK,
	light: { ...DARK, ...themeVars('[data-theme="light"]') },
	darcula: { ...DARK, ...themeVars('[data-theme="darcula"]') },
	gruvbox: { ...DARK, ...themeVars('[data-theme="gruvbox"]') },
};

function luminance(hex: string): number {
	const full =
		hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex.slice(0, 7);
	const channels = [1, 3, 5].map((s) => Number.parseInt(full.slice(s, s + 2), 16) / 255);
	const [r = 0, g = 0, b = 0] = channels.map((v) =>
		v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
	const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

function mix(a: string, b: string, percent: number): string {
	const byte = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	const channel = (i: number) =>
		Math.round(byte(a, i) * (percent / 100) + byte(b, i) * (1 - percent / 100))
			.toString(16)
			.padStart(2, "0");
	return `#${channel(0)}${channel(1)}${channel(2)}`;
}

const TEXT_PAIRS: [fg: string, bg: (v: Record<string, string>) => string, what: string][] = [
	["--text", (v) => v["--chrome"] as string, "body text on the window chrome"],
	["--text", (v) => v["--container-workspace-bg"] as string, "body text on the editor surface"],
	["--muted", (v) => v["--container-workspace-bg"] as string, "muted text on the editor surface"],
	["--text", (v) => v["--elevated"] as string, "the mock callout's text on its raised surface"],
	[
		"--green",
		(v) => v["--container-workspace-bg"] as string,
		"success icons on the editor surface",
	],
	[
		"--green",
		(v) => mix(v["--elevated"] as string, v["--container-workspace-bg"] as string, 30),
		"success icons on the chat demo's mixed surface",
	],
	["--on-accent", (v) => v["--accent"] as string, "the label on an accent fill"],
];

describe("every rendered foreground pair clears WCAG AA", () => {
	for (const [name, vars] of Object.entries(THEMES)) {
		for (const [fg, background, what] of TEXT_PAIRS) {
			it(`${name}: ${what}`, () => {
				const fgValue = vars[fg];
				if (!fgValue) throw new Error(`${name} is missing ${fg}`);
				expect(contrast(fgValue, background(vars))).toBeGreaterThanOrEqual(4.5);
			});
		}
	}
});

describe("the focus ring is a visible indicator", () => {
	for (const [name, vars] of Object.entries(THEMES)) {
		it(`${name}: ring against the editor surface`, () => {
			const ring =
				vars["--focus-ring"] === "var(--accent)" ? vars["--accent"] : vars["--focus-ring"];
			if (!ring) throw new Error(`${name} has no --focus-ring`);
			expect(contrast(ring, vars["--container-workspace-bg"] as string)).toBeGreaterThanOrEqual(3);
		});
	}
});
