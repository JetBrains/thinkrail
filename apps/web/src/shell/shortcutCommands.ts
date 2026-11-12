import {
	createQuitConfirmation,
	type NativeCommand,
	type NativeQuitHint,
	type QuitConfirmationDependencies,
} from "@thinkrail/contracts";
import { platformFamily } from "../lib";

export type ShortcutPlatform = Exclude<ReturnType<typeof platformFamily>, "other"> | "browser";

export type ShortcutCommandId = NativeCommand | "quit";

interface ShortcutChord {
	code: string;
	inTerminal: boolean;
}

interface ShortcutCommand {
	id: ShortcutCommandId;
	chords: Partial<Record<ShortcutPlatform, readonly ShortcutChord[]>>;
}

const CLOSE_ITEM_CHORDS: readonly ShortcutChord[] = [
	{ code: "KeyW", inTerminal: false },
	{ code: "F4", inTerminal: true },
];

const OPEN_SETTINGS_CHORDS: readonly ShortcutChord[] = [{ code: "Comma", inTerminal: true }];

const PUNCTUATION: Readonly<Record<string, string>> = { Comma: "," };

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
	{ id: "close-item", chords: { windows: CLOSE_ITEM_CHORDS, linux: CLOSE_ITEM_CHORDS } },
	{ id: "quit", chords: { linux: [{ code: "KeyQ", inTerminal: true }] } },
	{ id: "open-settings", chords: { windows: OPEN_SETTINGS_CHORDS, linux: OPEN_SETTINGS_CHORDS } },
];

export function hasWebShortcuts(platform: ShortcutPlatform) {
	return SHORTCUT_COMMANDS.some((command) => (command.chords[platform]?.length ?? 0) > 0);
}

export function shortcutPlatform(hasNativeBridge: boolean, platform?: string): ShortcutPlatform {
	if (!hasNativeBridge) return "browser";
	const family = platformFamily(platform);
	return family === "other" ? "browser" : family;
}

type ChordEvent = Pick<
	KeyboardEvent,
	"code" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

function chordMatches(chord: ShortcutChord, event: ChordEvent) {
	const letter = /^Key([A-Z])$/.exec(chord.code)?.[1];
	if (letter && /^[a-z]$/i.test(event.key)) {
		return !event.shiftKey && event.key.toUpperCase() === letter;
	}
	const character = PUNCTUATION[chord.code];
	if (character && /^[!-~]$/.test(event.key)) return event.key === character;
	return !event.shiftKey && chord.code === event.code;
}

export function matchShortcut(
	event: ChordEvent,
	platform: ShortcutPlatform,
	inTerminal: () => boolean,
): ShortcutCommandId | null {
	if (!event.ctrlKey || event.metaKey || event.altKey) return null;
	for (const command of SHORTCUT_COMMANDS) {
		const chord = command.chords[platform]?.find((candidate) => chordMatches(candidate, event));
		if (chord && (chord.inTerminal || !inTerminal())) return command.id;
	}
	return null;
}

type ShortcutKeyEvent = ChordEvent &
	Pick<KeyboardEvent, "repeat" | "target" | "preventDefault" | "stopPropagation">;

export interface WebShortcutsOptions extends Pick<QuitConfirmationDependencies, "now" | "every"> {
	platform: ShortcutPlatform;
	closeItem(): void;
	openSettings(): void;
	quit(): void;
	onQuitHint(hint: NativeQuitHint): void;
	isInTerminal(target: EventTarget | null): boolean;
}

export function createWebShortcuts(options: WebShortcutsOptions) {
	let quitHeldCode: string | null = null;
	const quitConfirmation = createQuitConfirmation({
		readHeld: () => quitHeldCode !== null,
		canShowHint: () => true,
		quit: options.quit,
		onHint: options.onQuitHint,
		now: options.now,
		every: options.every,
	});
	const handlers: Record<ShortcutCommandId, () => void> = {
		"close-item": options.closeItem,
		"open-settings": options.openSettings,
		quit: () => quitConfirmation.press(true),
	};

	function keydown(event: ShortcutKeyEvent) {
		const id = matchShortcut(event, options.platform, () => options.isInTerminal(event.target));
		if (!id) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat) return;
		if (id === "quit") quitHeldCode = event.code;
		handlers[id]();
	}

	function keyup(event: Pick<KeyboardEvent, "code" | "key">) {
		if (quitHeldCode === null || (event.code !== quitHeldCode && event.key !== "Control")) return;
		quitHeldCode = null;
		quitConfirmation.sync();
	}

	function cancel() {
		quitHeldCode = null;
		quitConfirmation.cancel();
	}

	function resetQuit() {
		quitHeldCode = null;
		quitConfirmation.reset();
	}

	return { keydown, keyup, cancel, resetQuit, run: (id: NativeCommand) => handlers[id]() };
}
