const IME_SENTINEL_KEYCODE = 229;

export function isImeComposing(event: { isComposing: boolean; keyCode: number }): boolean {
	return event.isComposing || event.keyCode === IME_SENTINEL_KEYCODE;
}

export function yieldEscapeToIme(
	handler: ((event: KeyboardEvent) => void) | undefined,
): (event: KeyboardEvent) => void {
	return (event) => {
		if (isImeComposing(event)) {
			event.preventDefault();
			return;
		}
		handler?.(event);
	};
}

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;

export function browserPlatform(): string {
	return typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
}

export function isApplePlatform(platform = browserPlatform()): boolean {
	return APPLE_PLATFORM.test(platform);
}

export function hasPlatformModifier(
	event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
	platform = browserPlatform(),
): boolean {
	return isApplePlatform(platform)
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}

export interface ChordModifiers {
	readonly mod?: boolean | undefined;
	readonly ctrl?: boolean | undefined;
	readonly alt?: boolean | undefined;
	readonly shift?: boolean | undefined;
}

export interface ChordCaps extends ChordModifiers {
	readonly key: string;
}

export interface PhysicalKeyChord extends ChordCaps {
	readonly code: string;
}

export interface PressableChord extends ChordCaps {
	readonly code?: string | undefined;
	readonly typed?: boolean | undefined;
}

export type ChordPressEvent = Pick<
	KeyboardEvent,
	"code" | "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
> &
	Partial<Pick<KeyboardEvent, "getModifierState">>;

export function chordPressed(
	chord: PressableChord,
	event: ChordPressEvent,
	platform: string,
	{ ignoreShift = false }: { ignoreShift?: boolean } = {},
): boolean {
	const apple = isApplePlatform(platform);
	const mod = chord.mod === true;
	return (
		!(chord.alt && !apple && event.getModifierState?.("AltGraph")) &&
		(chord.typed
			? event.key === chord.key
			: event.code === chord.code && (ignoreShift || event.shiftKey === (chord.shift === true))) &&
		event.ctrlKey === (chord.ctrl === true || (mod && !apple)) &&
		event.metaKey === (mod && apple) &&
		event.altKey === (chord.alt === true)
	);
}

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

export function keyCap(key: string): string {
	return KEY_CAPS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

const LETTER_CODE = /^Key([A-Z])$/;
const DIGIT_CODE = /^Digit(\d)$/;

export function codeLabel(code: string): string {
	const letter = LETTER_CODE.exec(code)?.[1];
	if (letter !== undefined) return letter;
	const digit = DIGIT_CODE.exec(code)?.[1];
	if (digit !== undefined) return digit;
	const numpad = /^Numpad(\d)$/.exec(code)?.[1];
	if (numpad !== undefined) return `Num ${numpad}`;
	return keyCap(CODE_KEYS[code] ?? code);
}

export function chordCaps(chord: ChordCaps, platform = browserPlatform()): string[] {
	const keys: string[] = [];
	if (isApplePlatform(platform)) {
		if (chord.ctrl) keys.push("⌃");
		if (chord.alt) keys.push("⌥");
		if (chord.shift) keys.push("⇧");
		if (chord.mod) keys.push("⌘");
	} else {
		if (chord.mod || chord.ctrl) keys.push("Ctrl");
		if (chord.alt) keys.push("Alt");
		if (chord.shift) keys.push("Shift");
	}
	keys.push(chord.key);
	return keys;
}

function ariaKey(chord: PressableChord): string {
	if (chord.typed || chord.code === undefined) return chord.key;
	const { code } = chord;
	const named = LETTER_CODE.exec(code)?.[1] ?? DIGIT_CODE.exec(code)?.[1];
	if (named !== undefined) return named;
	if (code === "Space") return "Space";
	const typed = CODE_KEYS[code];
	return typed !== undefined && typed.length === 1 ? typed : code;
}

export function ariaKeyShortcuts(
	chords: readonly PressableChord[],
	platform = browserPlatform(),
): string {
	const apple = isApplePlatform(platform);
	const one = (chord: PressableChord) =>
		[
			chord.ctrl || (chord.mod && !apple) ? "Control" : "",
			chord.mod && apple ? "Meta" : "",
			chord.alt ? "Alt" : "",
			chord.shift && !chord.typed ? "Shift" : "",
			ariaKey(chord),
		]
			.filter(Boolean)
			.join("+");
	return [...new Set(chords.map(one))].join(" ");
}

const FUNCTION_CODE = /^F\d{1,2}$/;

export function isTypingChord(chord: PhysicalKeyChord): boolean {
	return (
		!chord.mod &&
		!chord.ctrl &&
		!chord.alt &&
		chord.code !== "Escape" &&
		!FUNCTION_CODE.test(chord.code)
	);
}

export interface LocalKeyCommand {
	readonly id: string;
	readonly chords: readonly PhysicalKeyChord[];
}

export const ARROW_TWIN_COMMANDS = [
	{ id: "arrows.left", arrow: "ArrowLeft", chords: [{ code: "KeyH", key: "H" }] },
	{ id: "arrows.down", arrow: "ArrowDown", chords: [{ code: "KeyJ", key: "J" }] },
	{ id: "arrows.up", arrow: "ArrowUp", chords: [{ code: "KeyK", key: "K" }] },
	{ id: "arrows.right", arrow: "ArrowRight", chords: [{ code: "KeyL", key: "L" }] },
] as const satisfies readonly (LocalKeyCommand & { readonly arrow: string })[];

export const ARROW_TWINS_SCOPE = "arrows";
