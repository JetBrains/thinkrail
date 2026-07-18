import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names and de-dupe conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** True for a markdown file path (`.md` / `.markdown`, case-insensitive) — the rendered-preview gate. */
export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

let colorCanvas: CanvasRenderingContext2D | null | undefined;

function canvasNormalize(color: string): string {
	if (typeof document === "undefined") return "";
	colorCanvas ??= document.createElement("canvas").getContext("2d");
	if (!colorCanvas) return "";
	// An invalid assignment leaves fillStyle unchanged, so two different priors agreeing means `color`
	// really parsed (and a canvas serializes it canonically: `#rrggbb`, or `rgba()` when it has alpha).
	colorCanvas.fillStyle = "#000000";
	colorCanvas.fillStyle = color;
	const first = colorCanvas.fillStyle;
	colorCanvas.fillStyle = "#ffffff";
	colorCanvas.fillStyle = color;
	return first === colorCanvas.fillStyle ? first : "";
}

/**
 * Canonicalize a CSS color to hex (`#rrggbb`/`#rrggbbaa`), or `""` when it can't be parsed. The built CSS
 * is minified, so a token read via `getComputedStyle` can come back in ANY equivalent form (`#fff`,
 * `gray`, `rgb(…)`) — and strict consumers (Monaco's theme colors, xterm's palette) only accept hex.
 * Non-hex forms round-trip through a canvas, which serializes solid colors to `#rrggbb` and alpha colors
 * to `rgba()` (converted here).
 */
export function cssColorToHex(color: string): string {
	const value = color.trim();
	const short = /^#([0-9a-f]{3,4})$/i.exec(value)?.[1];
	if (short) return `#${[...short].map((c) => c + c).join("")}`;
	if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
	const parsed = canvasNormalize(value);
	if (parsed.startsWith("#")) return parsed;
	const [, r, g, b, a] = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(parsed) ?? [];
	const channels = [Number(r), Number(g), Number(b), Math.round(Number(a) * 255)];
	if (channels.some((c) => !Number.isFinite(c))) return "";
	return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Drop a leading YAML frontmatter block (a `---` line, its body, and a closing `---`/`...` line) so the
 * rendered markdown view doesn't turn spec metadata into a stray heading — the conventional behavior for
 * rendered markdown (source view still shows it). No frontmatter → returned unchanged.
 */
export function stripFrontmatter(text: string): string {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	return match ? text.slice(match[0].length) : text;
}
