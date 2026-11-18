import { createContext, type ReactNode, use, useMemo } from "react";
import {
	ariaKeyShortcuts,
	browserPlatform,
	type ChordPressEvent,
	chordCaps,
	chordPressed,
	isApplePlatform,
	isImeComposing,
	isTypingChord,
	keyCap,
	type LocalKeyCommand,
	type PhysicalKeyChord,
} from "./keyboard";

export interface LocalKeyBinding {
	readonly id: string;
	readonly chord: PhysicalKeyChord;
}

export interface LocalKeymap {
	readonly platform: string;
	readonly scopes: ReadonlyMap<string, readonly LocalKeyBinding[]>;
	readonly isTextEntry: (target: EventTarget | null) => boolean;
}

export type LocalKeyEvent = ChordPressEvent &
	Pick<KeyboardEvent, "isComposing" | "keyCode" | "target"> &
	Partial<Pick<KeyboardEvent, "composedPath">>;

export interface LocalKeyMatchOptions {
	readonly ignoreShift?: boolean;
	readonly textEntry?: boolean;
}

export interface LocalKeys {
	readonly match: (event: LocalKeyEvent, options?: LocalKeyMatchOptions) => string | null;
	readonly caps: (id: string) => string[];
	readonly label: (id: string) => string;
	readonly aria: (...ids: string[]) => string | undefined;
}

const LocalKeymapContext = createContext<LocalKeymap | null>(null);

export function LocalKeymapProvider({
	value,
	children,
}: {
	value: LocalKeymap;
	children: ReactNode;
}) {
	return <LocalKeymapContext value={value}>{children}</LocalKeymapContext>;
}

function isPlainTextEntry(target: EventTarget | null): boolean {
	if (target === null || !("tagName" in target)) return false;
	const editable = "isContentEditable" in target && target.isContentEditable === true;
	return editable || /^(INPUT|TEXTAREA|SELECT)$/.test(String(target.tagName));
}

function defaultBindings(defaults: readonly LocalKeyCommand[]): LocalKeyBinding[] {
	return defaults.flatMap(({ id, chords }) =>
		chords.map((chord) => ({ id, chord: { ...chord, key: keyCap(chord.key) } })),
	);
}

export function localKeys(
	keymap: LocalKeymap | null,
	scope: string,
	defaults: readonly LocalKeyCommand[],
): LocalKeys {
	const platform = keymap?.platform ?? browserPlatform();
	const bindings = keymap?.scopes.get(scope) ?? defaultBindings(defaults);
	const isTextEntry = keymap?.isTextEntry ?? isPlainTextEntry;
	const chordsOf = (id: string) =>
		bindings.flatMap((binding) => (binding.id === id ? [binding.chord] : []));
	const caps = (id: string) => {
		const [chord] = chordsOf(id);
		return chord ? chordCaps(chord, platform) : [];
	};
	return {
		match(event, { ignoreShift = false, textEntry }: LocalKeyMatchOptions = {}) {
			if (isImeComposing(event)) return null;
			const typing = textEntry ?? isTextEntry(event.composedPath?.()[0] ?? event.target);
			const pressed = (relaxShift: boolean) =>
				bindings.find(
					({ chord }) =>
						!(typing && isTypingChord(chord)) &&
						chordPressed(chord, event, platform, { ignoreShift: relaxShift }),
				)?.id ?? null;
			return pressed(false) ?? (ignoreShift && event.shiftKey ? pressed(true) : null);
		},
		caps,
		label: (id) => caps(id).join(isApplePlatform(platform) ? "" : "+"),
		aria(...ids) {
			const chords = ids.flatMap(chordsOf);
			return chords.length === 0 ? undefined : ariaKeyShortcuts(chords, platform);
		},
	};
}

export function useLocalKeys(scope: string, defaults: readonly LocalKeyCommand[]): LocalKeys {
	const keymap = use(LocalKeymapContext);
	return useMemo(() => localKeys(keymap, scope, defaults), [keymap, scope, defaults]);
}
