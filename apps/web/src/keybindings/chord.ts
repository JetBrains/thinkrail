import { isKeybindingChord, isModifierKeyCode, KEYBINDING_MODIFIERS } from "@thinkrail/contracts";
import { platformFamily } from "../lib";
import type { KeyChord, PhysicalChord } from "./keybindings";

type ChordFields = Pick<PhysicalChord, "code" | "mod" | "ctrl" | "alt" | "shift">;

type ModifierFields = Pick<KeyChord, "mod" | "ctrl" | "alt" | "shift">;

const KEY_CAPS: Readonly<Record<string, string>> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Enter: "↵",
	Escape: "Esc",
	PageUp: "PgUp",
	PageDown: "PgDn",
	" ": "Space",
};

const CODE_KEYS: Readonly<Record<string, string>> = {
	Backquote: "`",
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Semicolon: ";",
	Quote: "'",
	Comma: ",",
	Period: ".",
	Slash: "/",
	Space: " ",
	NumpadAdd: "Num +",
	NumpadSubtract: "Num -",
	NumpadMultiply: "Num *",
	NumpadDivide: "Num /",
	NumpadDecimal: "Num .",
	NumpadEnter: "Num ↵",
};

const BROWSER_RESERVED = [
	"Mod+KeyT",
	"Mod+KeyN",
	"Mod+KeyW",
	"Mod+KeyQ",
	"Mod+Tab",
	"Mod+Shift+Tab",
	"Mod+Shift+KeyT",
	"Mod+Shift+KeyN",
	"Mod+Shift+KeyW",
] as const;

const FUNCTION_KEY = /^F(?:[1-9]|1[0-2])$/;

export function keyCap(key: string): string {
	return KEY_CAPS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export function codeLabel(code: string): string {
	const letter = /^Key([A-Z])$/.exec(code)?.[1];
	if (letter !== undefined) return letter;
	const digit = /^Digit(\d)$/.exec(code)?.[1];
	if (digit !== undefined) return digit;
	const numpad = /^Numpad(\d)$/.exec(code)?.[1];
	if (numpad !== undefined) return `Num ${numpad}`;
	return keyCap(CODE_KEYS[code] ?? code);
}

export function parseChord(text: string): PhysicalChord | null {
	if (!isKeybindingChord(text)) return null;
	const modifiers = text.split("+");
	const code = modifiers.pop() ?? "";
	return {
		code,
		key: codeLabel(code),
		...(modifiers.includes("Mod") ? { mod: true } : {}),
		...(modifiers.includes("Ctrl") ? { ctrl: true } : {}),
		...(modifiers.includes("Alt") ? { alt: true } : {}),
		...(modifiers.includes("Shift") ? { shift: true } : {}),
	};
}

function modifierNames(chord: ModifierFields): string[] {
	const flags = { Mod: chord.mod, Ctrl: chord.ctrl, Alt: chord.alt, Shift: chord.shift };
	return KEYBINDING_MODIFIERS.filter((modifier) => flags[modifier] === true);
}

export function formatChord(chord: ChordFields): string {
	return [...modifierNames(chord), chord.code].join("+");
}

export function chordText(chord: KeyChord): string {
	return chord.typed ? [...modifierNames(chord), chord.key].join("+") : formatChord(chord);
}

export function chordSignature(chord: KeyChord, apple: boolean): string {
	const control = chord.ctrl === true || (chord.mod === true && !apple);
	const held = [
		control ? "Control" : "",
		chord.alt ? "Alt" : "",
		chord.shift && !chord.typed ? "Shift" : "",
		chord.mod && apple ? "Meta" : "",
	].join("");
	return chord.typed ? `${held}:typed:${chord.key}` : `${held}:${chord.code}`;
}

export function isPlainChord(chord: KeyChord): boolean {
	return !chord.mod && !chord.ctrl && !chord.alt && !(chord.code && FUNCTION_KEY.test(chord.code));
}

export function isBrowserReservedChord(chord: KeyChord | string, platform: string): boolean {
	const parsed = typeof chord === "string" ? parseChord(chord) : chord;
	if (parsed === null || parsed.typed) return false;
	const apple = platformFamily(platform) === "apple";
	const signature = chordSignature(parsed, apple);
	return BROWSER_RESERVED.some((reserved) => {
		const candidate = parseChord(reserved);
		return candidate !== null && chordSignature(candidate, apple) === signature;
	});
}

type ChordEvent = Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> &
	Partial<Pick<KeyboardEvent, "getModifierState">>;

export type RecordedChord =
	| { readonly kind: "chord"; readonly chord: string; readonly browserReserved: boolean }
	| { readonly kind: "rejected"; readonly reason: "modifierOnly" | "plain" }
	| { readonly kind: "ignored" };

const IGNORED: RecordedChord = { kind: "ignored" };

export function chordFromEvent(
	event: ChordEvent,
	platform: string,
	{ allowPlain = false }: { allowPlain?: boolean } = {},
): RecordedChord {
	if (isModifierKeyCode(event.code)) return { kind: "rejected", reason: "modifierOnly" };
	const apple = platformFamily(platform) === "apple";
	if (!apple && (event.metaKey || event.getModifierState?.("AltGraph"))) return IGNORED;
	const fields: PhysicalChord = {
		code: event.code,
		key: codeLabel(event.code),
		mod: apple ? event.metaKey : event.ctrlKey,
		ctrl: apple && event.ctrlKey,
		alt: event.altKey,
		shift: event.shiftKey,
	};
	const chord = formatChord(fields);
	if (!isKeybindingChord(chord)) return IGNORED;
	if (!allowPlain && isPlainChord(fields)) return { kind: "rejected", reason: "plain" };
	return { kind: "chord", chord, browserReserved: isBrowserReservedChord(chord, platform) };
}
