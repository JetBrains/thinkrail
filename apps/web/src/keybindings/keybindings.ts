import { type ChordPressEvent, chordPressed } from "@thinkrail/ui/keyboard";
import type { CommandShortcut } from "../commands";
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
	| "tab.close"
	| "tab.moveToPreviousGroup"
	| "tab.moveToNextGroup"
	| "group.splitRight"
	| "shortcuts.open"
	| (typeof FOCUS_GROUP_BINDINGS)[number];

type PlatformScope = "apple" | "other";

interface ChordScope extends CommandShortcut {
	readonly displayOnly?: boolean;
	readonly platform?: PlatformScope;
}

export interface PhysicalChord extends ChordScope {
	readonly code: string;
	readonly typed?: never;
}

interface TypedChord extends ChordScope {
	readonly typed: true;
	readonly code?: never;
}

export type KeyChord = PhysicalChord | TypedChord;

export type KeybindingEvent = ChordPressEvent;

export const KEYBINDINGS: Readonly<Record<KeybindingId, readonly [KeyChord, ...KeyChord[]]>> = {
	"view.toggleLeft": [{ code: "KeyB", key: "B", mod: true }],
	"view.toggleRight": [{ code: "KeyJ", key: "J", mod: true }],
	"view.toggleBottom": [{ code: "KeyJ", key: "J", mod: true, shift: true }],
	"workspace.new": [
		{ code: "KeyN", key: "N", mod: true },
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
	"tab.close": [
		{ code: "KeyW", key: "W", mod: true, displayOnly: true },
		{ code: "KeyW", key: "W", mod: true, alt: true },
	],
	"tab.moveToPreviousGroup": [
		{ code: "ArrowLeft", key: "←", ctrl: true, mod: true, platform: "apple" },
		{ code: "ArrowLeft", key: "←", ctrl: true, alt: true, platform: "other" },
	],
	"tab.moveToNextGroup": [
		{ code: "ArrowRight", key: "→", ctrl: true, mod: true, platform: "apple" },
		{ code: "ArrowRight", key: "→", ctrl: true, alt: true, platform: "other" },
	],
	"group.splitRight": [{ code: "Backslash", key: "\\", mod: true }],
	"shortcuts.open": [{ typed: true, key: "?", mod: true }],
};

export function onPlatform(chord: KeyChord, apple: boolean): boolean {
	return chord.platform === undefined || (chord.platform === "apple") === apple;
}

export function pressed(chord: KeyChord, event: KeybindingEvent, platform: string): boolean {
	const apple = platformFamily(platform) === "apple";
	return !chord.displayOnly && onPlatform(chord, apple) && chordPressed(chord, event, platform);
}

export function displayShortcut({
	code: _code,
	typed: _typed,
	displayOnly: _displayOnly,
	platform: _platform,
	...shortcut
}: KeyChord): CommandShortcut {
	return shortcut;
}

export function keysLabel(keys: readonly string[], platform?: string): string {
	return keys.join(platformFamily(platform) === "apple" ? "" : "+");
}
