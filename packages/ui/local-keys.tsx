import { createContext, type ReactNode, use, useMemo } from "react";
import {
	ariaKeyShortcuts,
	browserPlatform,
	type ChordPressEvent,
	chordCaps,
	chordPressed,
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
}

export interface LocalKeys {
	readonly match: (event: LocalKeyEvent, options?: LocalKeyMatchOptions) => string | null;
	readonly caps: (id: string) => string[];
	readonly aria: (id: string) => string | undefined;
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
	return {
		match(event, { ignoreShift = false } = {}) {
			if (isImeComposing(event)) return null;
			const textEntry = isTextEntry(event.composedPath?.()[0] ?? event.target);
			for (const { id, chord } of bindings) {
				if (textEntry && isTypingChord(chord)) continue;
				if (chordPressed(chord, event, platform, { ignoreShift })) return id;
			}
			return null;
		},
		caps(id) {
			const [chord] = chordsOf(id);
			return chord ? chordCaps(chord, platform) : [];
		},
		aria(id) {
			const chords = chordsOf(id);
			return chords.length === 0 ? undefined : ariaKeyShortcuts(chords, platform);
		},
	};
}

export function useLocalKeys(scope: string, defaults: readonly LocalKeyCommand[]): LocalKeys {
	const keymap = use(LocalKeymapContext);
	return useMemo(() => localKeys(keymap, scope, defaults), [keymap, scope, defaults]);
}
