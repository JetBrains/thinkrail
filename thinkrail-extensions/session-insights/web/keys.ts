import type { ExtensionCommand, ExtensionShortcut } from "@thinkrail/extension-api/web";
import type { LocalKeys } from "@thinkrail/ui/local-keys";

export const PANEL_SCOPE = "session-insights.panel";

export const OPEN_SESSIONS = "session-insights.openSessions";

export const OPEN_SESSIONS_COMMAND: ExtensionCommand = {
	id: OPEN_SESSIONS,
	title: "sessionInsights.keys.openSessions",
	chords: [{ code: "KeyI", key: "I", ctrl: true, alt: true }],
};

export const PANEL_KEYS = {
	search: "session-insights.search",
	nextMatch: "session-insights.nextMatch",
	previousMatch: "session-insights.previousMatch",
	nextError: "session-insights.nextError",
	previousError: "session-insights.previousError",
	nextRetry: "session-insights.nextRetry",
	previousRetry: "session-insights.previousRetry",
	zoomToSelection: "session-insights.zoomToSelection",
	zoomIn: "session-insights.zoomIn",
	zoomOut: "session-insights.zoomOut",
	zoomFit: "session-insights.zoomFit",
} as const;

const command = (
	id: string,
	title: ExtensionCommand["title"],
	...chords: ExtensionCommand["chords"]
): ExtensionCommand => ({ id, title, scope: PANEL_SCOPE, chords });

export const PANEL_COMMANDS: readonly ExtensionCommand[] = [
	command(PANEL_KEYS.search, "sessionInsights.keys.search", { code: "Slash", key: "/" }),
	command(PANEL_KEYS.nextMatch, "sessionInsights.keys.nextMatch", { code: "KeyN", key: "N" }),
	command(PANEL_KEYS.previousMatch, "sessionInsights.keys.previousMatch", {
		code: "KeyN",
		key: "N",
		shift: true,
	}),
	command(PANEL_KEYS.nextError, "sessionInsights.keys.nextError", { code: "KeyE", key: "E" }),
	command(PANEL_KEYS.previousError, "sessionInsights.keys.previousError", {
		code: "KeyE",
		key: "E",
		shift: true,
	}),
	command(PANEL_KEYS.nextRetry, "sessionInsights.keys.nextRetry", { code: "KeyR", key: "R" }),
	command(PANEL_KEYS.previousRetry, "sessionInsights.keys.previousRetry", {
		code: "KeyR",
		key: "R",
		shift: true,
	}),
	command(PANEL_KEYS.zoomToSelection, "sessionInsights.keys.zoomToSelection", {
		code: "KeyZ",
		key: "Z",
	}),
	command(
		PANEL_KEYS.zoomIn,
		"sessionInsights.trace.zoomIn",
		{ code: "Equal", key: "+" },
		{ code: "Equal", key: "+", shift: true },
		{ code: "NumpadAdd", key: "Num +" },
	),
	command(
		PANEL_KEYS.zoomOut,
		"sessionInsights.trace.zoomOut",
		{ code: "Minus", key: "−" },
		{ code: "NumpadSubtract", key: "Num −" },
	),
	command(
		PANEL_KEYS.zoomFit,
		"sessionInsights.keys.zoomFit",
		{ code: "Digit0", key: "0" },
		{ code: "Numpad0", key: "Num 0" },
	),
];

const UP = { code: "ArrowUp", key: "ArrowUp" } as const;
const DOWN = { code: "ArrowDown", key: "ArrowDown" } as const;

export const PANEL_SHORTCUTS: readonly ExtensionShortcut[] = [
	{ id: "session-insights.rows", title: "sessionInsights.keys.rows", keys: [UP, DOWN] },
	{
		id: "session-insights.sideways",
		title: "sessionInsights.keys.sideways",
		keys: [
			{ code: "ArrowLeft", key: "ArrowLeft" },
			{ code: "ArrowRight", key: "ArrowRight" },
		],
	},
	{
		id: "session-insights.edges",
		title: "sessionInsights.keys.edges",
		keys: [
			{ code: "Home", key: "Home" },
			{ code: "End", key: "End" },
		],
	},
	{
		id: "session-insights.pages",
		title: "sessionInsights.keys.pages",
		keys: [
			{ code: "PageUp", key: "PageUp" },
			{ code: "PageDown", key: "PageDown" },
		],
	},
	{
		id: "session-insights.details",
		title: "sessionInsights.keys.details",
		keys: [{ code: "Enter", key: "Enter" }],
	},
];

export function keyLabels(keys: Pick<LocalKeys, "label">, ...ids: string[]): string {
	return ids
		.map((id) => keys.label(id))
		.filter((label) => label !== "")
		.join("/");
}

export function plainKey(
	event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): boolean {
	return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
