export const KEYBINDING_MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift"] as const;

export type KeybindingModifier = (typeof KEYBINDING_MODIFIERS)[number];

export type KeybindingOverrides = Record<string, string[]>;

const MODIFIER_KEY_CODE =
	/^(?:(?:Shift|Control|Alt|Meta|OS)(?:Left|Right)|AltGraph|CapsLock|Fn|FnLock|NumLock|ScrollLock)$/;

const KEY_CODE = /^[A-Z][A-Za-z0-9]{0,31}$/;

export function isModifierKeyCode(code: string): boolean {
	return MODIFIER_KEY_CODE.test(code);
}

export function isKeybindingChord(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const parts = value.split("+");
	const code = parts.pop() ?? "";
	if (!KEY_CODE.test(code) || isModifierKeyCode(code) || code === "Unidentified") return false;
	if ((KEYBINDING_MODIFIERS as readonly string[]).includes(code)) return false;
	let next = 0;
	for (const part of parts) {
		const index = (KEYBINDING_MODIFIERS as readonly string[]).indexOf(part, next);
		if (index === -1) return false;
		next = index + 1;
	}
	return true;
}

export function isKeybindingOverrides(value: unknown): value is KeybindingOverrides {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return Object.entries(value).every(
		([id, chords]) =>
			id.trim().length > 0 && Array.isArray(chords) && chords.every(isKeybindingChord),
	);
}
