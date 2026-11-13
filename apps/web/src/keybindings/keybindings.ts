import { type CommandShortcut, shortcutKeys } from "../commands";
import { platformFamily } from "../lib";

export const FOCUS_GROUP_BINDINGS = [
	"focus.group1",
	"focus.group2",
	"focus.group3",
	"focus.group4",
	"focus.group5",
	"focus.group6",
	"focus.group7",
	"focus.group8",
	"focus.group9",
] as const;

export type KeybindingId =
	| "view.toggleLeft"
	| "view.toggleRight"
	| "view.toggleBottom"
	| "view.files"
	| "view.changes"
	| "workspace.new"
	| "search.open"
	| "files.findInFiles"
	| "chat.history"
	| "region.next"
	| "region.previous"
	| "focus.composer"
	| "focus.projects"
	| "focus.terminal"
	| (typeof FOCUS_GROUP_BINDINGS)[number];

interface KeyChord extends CommandShortcut {
	readonly code: string;
	readonly browserReserved?: boolean;
}

type KeybindingEvent = Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

export const KEYBINDINGS: Readonly<Record<KeybindingId, readonly [KeyChord, ...KeyChord[]]>> = {
	"view.toggleLeft": [{ code: "KeyB", key: "B", mod: true }],
	"view.toggleRight": [{ code: "KeyJ", key: "J", mod: true }],
	"view.toggleBottom": [{ code: "KeyJ", key: "J", mod: true, shift: true }],
	"workspace.new": [
		{ code: "KeyN", key: "N", mod: true, browserReserved: true },
		{ code: "KeyN", key: "N", mod: true, alt: true },
	],
	"search.open": [{ code: "KeyK", key: "K", mod: true }],
	"files.findInFiles": [{ code: "KeyF", key: "F", mod: true, shift: true }],
	"chat.history": [{ code: "KeyR", key: "R", ctrl: true }],
	"view.files": [{ code: "KeyE", key: "E", mod: true, shift: true }],
	"view.changes": [{ code: "KeyG", key: "G", mod: true, shift: true }],
	"region.next": [{ code: "F6", key: "F6" }],
	"region.previous": [{ code: "F6", key: "F6", shift: true }],
	"focus.composer": [{ code: "KeyL", key: "L", mod: true }],
	"focus.projects": [{ code: "Digit0", key: "0", mod: true }],
	"focus.group1": [{ code: "Digit1", key: "1", mod: true }],
	"focus.group2": [{ code: "Digit2", key: "2", mod: true }],
	"focus.group3": [{ code: "Digit3", key: "3", mod: true }],
	"focus.group4": [{ code: "Digit4", key: "4", mod: true }],
	"focus.group5": [{ code: "Digit5", key: "5", mod: true }],
	"focus.group6": [{ code: "Digit6", key: "6", mod: true }],
	"focus.group7": [{ code: "Digit7", key: "7", mod: true }],
	"focus.group8": [{ code: "Digit8", key: "8", mod: true }],
	"focus.group9": [{ code: "Digit9", key: "9", mod: true }],
	"focus.terminal": [{ code: "Backquote", key: "`", ctrl: true }],
};

function pressed(chord: KeyChord, event: KeybindingEvent, apple: boolean): boolean {
	const mod = chord.mod === true;
	return (
		event.code === chord.code &&
		event.ctrlKey === (chord.ctrl === true || (mod && !apple)) &&
		event.metaKey === (mod && apple) &&
		event.shiftKey === (chord.shift === true) &&
		event.altKey === (chord.alt === true)
	);
}

export function matchKeybinding(event: KeybindingEvent, platform?: string): KeybindingId | null {
	const apple = platformFamily(platform) === "apple";
	for (const [id, chords] of Object.entries(KEYBINDINGS) as [KeybindingId, readonly KeyChord[]][]) {
		if (chords.some((chord) => pressed(chord, event, apple))) return id;
	}
	return null;
}

export function keybindingShortcut(
	id: KeybindingId,
	{ browser = false }: { browser?: boolean } = {},
): CommandShortcut {
	const chords = KEYBINDINGS[id];
	const chord = (browser ? chords.find((each) => !each.browserReserved) : undefined) ?? chords[0];
	const { code: _code, browserReserved: _reserved, ...shortcut } = chord;
	return shortcut;
}

function label(shortcut: CommandShortcut, platform?: string): string {
	return shortcutKeys(shortcut, platform).join(platformFamily(platform) === "apple" ? "" : "+");
}

export function keybindingLabel(
	id: KeybindingId,
	{ browser, platform }: { browser?: boolean; platform?: string } = {},
): string {
	return label(keybindingShortcut(id, browser === undefined ? {} : { browser }), platform);
}

export function keybindingLabels(id: KeybindingId, platform?: string): string[] {
	return KEYBINDINGS[id].map(({ code: _code, browserReserved: _reserved, ...shortcut }) =>
		label(shortcut, platform),
	);
}
