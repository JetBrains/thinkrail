import { cssColorToHex } from "@thinkrail/ui/theme";
import type { SeriesKey } from "./model";

export interface Palette {
	series: Readonly<Record<SeriesKey, string>>;
	/** The sequential ramp, low to high. */
	ramp: readonly string[];
	canvas: string;
	text: string;
	muted: string;
	subtle: string;
	grid: string;
	rule: string;
	error: string;
	warning: string;
	success: string;
	selected: string;
	focus: string;
}

/**
 * Resolves theme tokens to canvas-safe colours: a probe's computed `color` is an absolute colour
 * (`rgb()`, `rgba()` or `color(srgb …)`), canonicalized to hex, so canvas never parses a token's
 * `color-mix()` itself. The DOM names the same roles as `bg-series-n` / `text-series-n`.
 */
export function resolvePalette(root: HTMLElement): Palette {
	const probe = document.createElement("span");
	probe.setAttribute("aria-hidden", "true");
	probe.hidden = true;
	root.append(probe);
	const read = (variable: string): string => {
		probe.style.setProperty("color", `var(${variable})`);
		const computed = getComputedStyle(probe).color;
		return cssColorToHex(computed) || computed;
	};
	const palette: Palette = {
		series: {
			"series-1": read("--series-1"),
			"series-2": read("--series-2"),
			"series-3": read("--series-3"),
			"series-4": read("--series-4"),
			"series-5": read("--series-5"),
			"series-6": read("--series-6"),
			"series-7": read("--series-7"),
			"series-8": read("--series-8"),
			primary: read("--primary"),
		},
		ramp: [
			read("--ramp-1"),
			read("--ramp-2"),
			read("--ramp-3"),
			read("--ramp-4"),
			read("--ramp-5"),
		],
		canvas: read("--container-workspace-bg"),
		text: read("--text-default"),
		muted: read("--text-muted"),
		subtle: read("--text-subtle"),
		grid: read("--border-muted"),
		rule: read("--border-default"),
		error: read("--feedback-error"),
		warning: read("--feedback-warning"),
		success: read("--feedback-success"),
		selected: read("--control-bg-selected"),
		focus: read("--focus-ring"),
	};
	probe.remove();
	return palette;
}
