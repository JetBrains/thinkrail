/*
 * GENERATED — do not edit. Source: `src/styles/colors.json` (v1.0.0).
 * Regenerate with `bun run colors:generate`; `colors:check` fails when this file is stale.
 *
 * The manifest-key → CSS-variable map, and the per-appearance effect values.
 */

import type { ThemeColorKey } from "../schema";

export const COLOR_VARIABLES: Record<ThemeColorKey, readonly string[]> = {
	accent: ["--primary"],
	onAccent: ["--on-accent"],
	bubbleAccent: ["--bubble-accent"],
	background: ["--bg"],
	header: ["--bg-dark"],
	content: ["--surface-content"],
	sidebar: ["--surface-sidebar"],
	input: ["--input-bg"],
	elevated: ["--elevated"],
	hover: ["--hover"],
	border: ["--border"],
	borderStrong: ["--border2"],
	text: ["--text"],
	muted: ["--muted"],
	hint: ["--hint"],
	selection: ["--selection-bg"],
	selectionForeground: ["--selection-fg"],
	editorSelection: ["--sel"],
	editorSelectionForeground: ["--sel-fg"],
	info: ["--blue"],
	success: ["--green"],
	danger: ["--red"],
	warning: ["--gold"],
};

export const EFFECTS = {
	dark: {
		"--sunken": "rgba(0, 0, 0, 0.12)",
		"--overlay": "rgba(0, 0, 0, 0.5)",
		"--shadow-sm": "0 2px 8px rgba(0, 0, 0, 0.3)",
		"--shadow-md": "0 4px 16px rgba(0, 0, 0, 0.35)",
		"--shadow-lg": "0 8px 28px rgba(0, 0, 0, 0.4)",
	},
	light: {
		"--sunken": "rgba(0, 0, 0, 0.05)",
		"--overlay": "rgba(0, 0, 0, 0.5)",
		"--shadow-sm": "0 2px 8px rgba(0, 0, 0, 0.1)",
		"--shadow-md": "0 4px 16px rgba(0, 0, 0, 0.12)",
		"--shadow-lg": "0 8px 28px rgba(0, 0, 0, 0.14)",
	},
} as const;
