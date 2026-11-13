import { type CommandShortcut, shortcutKeys } from "../commands";
import { platformFamily } from "../lib";

export type KeybindingId =
	| "view.toggleLeft"
	| "view.toggleRight"
	| "view.toggleBottom"
	| "workspace.new"
	| "search.open"
	| "files.findInFiles"
	| "chat.history";

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
