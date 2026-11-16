import { isKeybindingChord, isModifierKeyCode, KEYBINDING_MODIFIERS } from "@thinkrail/contracts";
import { codeLabel } from "@thinkrail/ui/keyboard";
import { platformFamily } from "../lib";
import type { KeyChord, PhysicalChord } from "./keybindings";

type ChordFields = Pick<PhysicalChord, "code" | "mod" | "ctrl" | "alt" | "shift">;

type ModifierFields = Pick<KeyChord, "mod" | "ctrl" | "alt" | "shift">;

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

type ChordOwners = Readonly<Record<string, string>>;

const DESKTOP_SHARED = {
	"Mod+KeyW": "tab.close",
	"Mod+KeyQ": "desktop.quit",
	"Mod+Comma": "desktop.settings",
	"Mod+Equal": "desktop.zoomIn",
	"Mod+Shift+Equal": "desktop.zoomIn",
	"Mod+NumpadAdd": "desktop.zoomIn",
	"Mod+Minus": "desktop.zoomOut",
	"Mod+NumpadSubtract": "desktop.zoomOut",
	"Mod+Numpad0": "desktop.zoomReset",
} as const satisfies ChordOwners;

const DESKTOP_NATIVE = {
	apple: {
		...DESKTOP_SHARED,
		"Mod+KeyH": "desktop.hide",
		"Mod+Alt+KeyH": "desktop.hideOthers",
		"Mod+KeyM": "desktop.minimize",
	},
	other: { ...DESKTOP_SHARED, "Mod+F4": "desktop.closeItem" },
} as const satisfies Record<"apple" | "other", ChordOwners>;

const APP_FIXED = { "Mod+Shift+Space": "dictation" } as const satisfies ChordOwners;

const TYPED_POSITIONS: Readonly<Record<string, Pick<PhysicalChord, "code" | "shift">>> = {
	"?": { code: "Slash", shift: true },
};

const FUNCTION_KEY = /^F(?:[1-9]|1[0-2])$/;

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

export function heldSignatures(chord: KeyChord, apple: boolean): string[] {
	const signature = chordSignature(chord, apple);
	const position = chord.typed ? TYPED_POSITIONS[chord.key] : undefined;
	const physical = position ? parseChord(formatChord({ ...chord, ...position })) : null;
	return physical ? [signature, chordSignature(physical, apple)] : [signature];
}

const PRIMITIVE_CODES = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Enter",
	"NumpadEnter",
	"Escape",
	"Tab",
	"Space",
	"Home",
	"End",
	"PageUp",
	"PageDown",
]);

export function isLockedPrimitive(chord: KeyChord | string): boolean {
	const parsed = typeof chord === "string" ? parseChord(chord) : chord;
	return (
		parsed !== null &&
		!parsed.typed &&
		!parsed.mod &&
		!parsed.ctrl &&
		!parsed.alt &&
		PRIMITIVE_CODES.has(parsed.code)
	);
}

export function isPlainChord(chord: KeyChord): boolean {
	return !chord.mod && !chord.ctrl && !chord.alt && !(chord.code && FUNCTION_KEY.test(chord.code));
}

function chordIn(chord: KeyChord, list: readonly string[], apple: boolean): string | undefined {
	const signature = chordSignature(chord, apple);
	return list.find((text) => {
		const candidate = parseChord(text);
		return candidate !== null && chordSignature(candidate, apple) === signature;
	});
}

function ownerIn(chord: KeyChord, owners: ChordOwners, apple: boolean): string | null {
	const text = chordIn(chord, Object.keys(owners), apple);
	return text === undefined ? null : (owners[text] ?? null);
}

function nativeOwner(chord: KeyChord, apple: boolean): string | null {
	return ownerIn(chord, apple ? DESKTOP_NATIVE.apple : DESKTOP_NATIVE.other, apple);
}

export function isBrowserReservedChord(chord: KeyChord | string, platform: string): boolean {
	const parsed = typeof chord === "string" ? parseChord(chord) : chord;
	if (parsed === null || parsed.typed) return false;
	return chordIn(parsed, BROWSER_RESERVED, platformFamily(platform) === "apple") !== undefined;
}

export function isDesktopNativeChord(chord: KeyChord | string): boolean {
	const parsed = typeof chord === "string" ? parseChord(chord) : chord;
	return (
		parsed !== null &&
		!parsed.typed &&
		(nativeOwner(parsed, true) ?? nativeOwner(parsed, false)) !== null
	);
}

export function reservedChordOwner(chord: KeyChord, apple?: boolean): string | null {
	if (chord.typed) return null;
	for (const family of apple === undefined ? [true, false] : [apple]) {
		const owner = nativeOwner(chord, family) ?? ownerIn(chord, APP_FIXED, family);
		if (owner !== null) return owner;
	}
	return null;
}

type ChordEvent = Pick<KeyboardEvent, "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> &
	Partial<Pick<KeyboardEvent, "getModifierState">>;

export type RecordedChord =
	| { readonly kind: "chord"; readonly chord: string; readonly browserReserved: boolean }
	| { readonly kind: "rejected"; readonly reason: "modifierOnly" | "plain" }
	| { readonly kind: "rejected"; readonly reason: "locked"; readonly chord: string }
	| { readonly kind: "ignored" };

const IGNORED: RecordedChord = { kind: "ignored" };

export function chordFromEvent(
	event: ChordEvent,
	platform: string,
	{ allowPlain = false, allowLocked = false }: { allowPlain?: boolean; allowLocked?: boolean } = {},
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
	if (!allowLocked && isLockedPrimitive(fields))
		return { kind: "rejected", reason: "locked", chord };
	return { kind: "chord", chord, browserReserved: isBrowserReservedChord(chord, platform) };
}
