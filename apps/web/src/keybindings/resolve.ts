import type { MessageKey } from "@thinkrail/locales";
import { type CommandShortcut, shortcutKeys } from "../commands";
import { platformFamily } from "../lib";
import {
	chordSignature,
	chordText,
	formatChord,
	isBrowserReservedChord,
	isPlainChord,
	keyCap,
	parseChord,
} from "./chord";
import {
	displayShortcut,
	KEYBINDINGS,
	type KeybindingEvent,
	type KeyChord,
	keysLabel,
	onPlatform,
	type PhysicalChord,
	pressed,
} from "./keybindings";

export interface ExtensionCommandDefaults {
	readonly id: string;
	readonly title: MessageKey;
	readonly chords: readonly PhysicalChord[];
}

export interface ExtensionCommandSet {
	readonly extension: string;
	readonly enabled: boolean;
	readonly commands: readonly ExtensionCommandDefaults[];
}

export interface KeybindingsInput {
	readonly platform: string;
	readonly overrides?: Readonly<Record<string, readonly string[]>>;
	readonly extensions?: readonly ExtensionCommandSet[];
	readonly table?: Readonly<Record<string, readonly KeyChord[]>>;
}

export interface ResolvedChord {
	readonly chord: KeyChord;
	readonly text: string;
	readonly lostTo: string | null;
}

export interface ResolvedCommand {
	readonly id: string;
	readonly extension: string | null;
	readonly title: MessageKey | null;
	readonly enabled: boolean;
	readonly custom: boolean;
	readonly plain: boolean;
	readonly chords: readonly ResolvedChord[];
	readonly defaults: readonly KeyChord[];
}

export interface KeybindingConflict {
	readonly loser: string;
	readonly chord: string;
	readonly winner: string;
}

interface ActiveChord {
	readonly id: string;
	readonly chord: KeyChord;
}

export interface ResolvedKeybindings {
	readonly platform: string;
	readonly commands: readonly ResolvedCommand[];
	readonly byId: ReadonlyMap<string, ResolvedCommand>;
	readonly conflicts: readonly KeybindingConflict[];
	readonly active: readonly ActiveChord[];
}

interface Draft {
	readonly id: string;
	readonly extension: string | null;
	readonly title: MessageKey | null;
	readonly enabled: boolean;
	readonly custom: boolean;
	readonly plain: boolean;
	readonly chords: readonly KeyChord[];
	readonly defaults: readonly KeyChord[];
	readonly lostTo: Map<number, string>;
}

function distinct(chords: readonly KeyChord[], apple: boolean): KeyChord[] {
	const seen = new Set<string>();
	return chords.filter((chord) => {
		const signature = chordSignature(chord, apple);
		if (seen.has(signature)) return false;
		seen.add(signature);
		return true;
	});
}

function rank(draft: Draft): number {
	if (draft.custom) return 0;
	return draft.extension === null ? 1 : 2;
}

export function resolveKeybindings({
	platform,
	overrides = {},
	extensions = [],
	table = KEYBINDINGS,
}: KeybindingsInput): ResolvedKeybindings {
	const apple = platformFamily(platform) === "apple";
	const drafts: Draft[] = [];
	const seen = new Set<string>();
	const add = (
		id: string,
		extension: string | null,
		title: MessageKey | null,
		enabled: boolean,
		defaults: readonly KeyChord[],
	) => {
		if (seen.has(id)) return;
		seen.add(id);
		const plain = defaults.some(isPlainChord);
		const override = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
		const platformDefaults = defaults.filter((chord) => onPlatform(chord, apple));
		const chords = Array.isArray(override)
			? override.flatMap((text) => {
					const chord = parseChord(text);
					return chord && (plain || !isPlainChord(chord)) ? [chord] : [];
				})
			: platformDefaults;
		drafts.push({
			id,
			extension,
			title,
			enabled,
			custom: Array.isArray(override),
			plain,
			chords: distinct(chords, apple),
			defaults: platformDefaults,
			lostTo: new Map(),
		});
	};
	for (const [id, chords] of Object.entries(table)) add(id, null, null, true, chords);
	for (const { extension, enabled, commands } of extensions) {
		for (const command of commands) {
			const chords = command.chords.flatMap((chord) =>
				parseChord(formatChord(chord)) ? [{ ...chord, key: keyCap(chord.key) }] : [],
			);
			add(command.id, extension, command.title, enabled, chords);
		}
	}

	const owners = new Map<string, string>();
	const active: ActiveChord[] = [];
	const conflicts: KeybindingConflict[] = [];
	const ranked = drafts
		.filter((draft) => draft.enabled)
		.map((draft, order) => ({ draft, order }))
		.sort((a, b) => rank(a.draft) - rank(b.draft) || a.order - b.order);
	for (const { draft } of ranked) {
		draft.chords.forEach((chord, index) => {
			const signature = chordSignature(chord, apple);
			const owner = owners.get(signature);
			if (owner === undefined) {
				owners.set(signature, draft.id);
				if (!chord.displayOnly) active.push({ id: draft.id, chord });
				return;
			}
			draft.lostTo.set(index, owner);
			conflicts.push({ loser: draft.id, chord: chordText(chord), winner: owner });
		});
	}

	const commands = drafts.map(
		({ lostTo, chords, ...command }): ResolvedCommand => ({
			...command,
			chords: chords.map((chord, index) => ({
				chord,
				text: chordText(chord),
				lostTo: lostTo.get(index) ?? null,
			})),
		}),
	);
	return {
		platform,
		commands,
		byId: new Map(commands.map((command) => [command.id, command])),
		conflicts,
		active,
	};
}

export function matchKeybinding(
	keybindings: ResolvedKeybindings,
	event: KeybindingEvent,
	{ textEntry = true }: { textEntry?: boolean } = {},
): string | null {
	const apple = platformFamily(keybindings.platform) === "apple";
	for (const { id, chord } of keybindings.active) {
		if (textEntry && isPlainChord(chord)) continue;
		if (pressed(chord, event, apple)) return id;
	}
	return null;
}

interface ShownOptions {
	readonly browser?: boolean;
}

function activeChords(keybindings: ResolvedKeybindings, id: string): KeyChord[] {
	return (keybindings.byId.get(id)?.chords ?? [])
		.filter((chord) => chord.lostTo === null)
		.map(({ chord }) => chord);
}

export function keybindingShortcuts(
	keybindings: ResolvedKeybindings,
	id: string,
	{ browser = false }: ShownOptions = {},
): CommandShortcut[] {
	const chords = activeChords(keybindings, id);
	const delivered = browser
		? chords.filter((chord) => !isBrowserReservedChord(chord, keybindings.platform))
		: chords;
	return (delivered.length > 0 ? delivered : chords).map(displayShortcut);
}

export function keybindingShortcut(
	keybindings: ResolvedKeybindings,
	id: string,
	options: ShownOptions = {},
): CommandShortcut | undefined {
	return keybindingShortcuts(keybindings, id, options)[0];
}

export function keybindingKeys(
	keybindings: ResolvedKeybindings,
	id: string,
	options: ShownOptions = {},
): string[] {
	const shortcut = keybindingShortcut(keybindings, id, options);
	return shortcut ? shortcutKeys(shortcut, keybindings.platform) : [];
}

export function keybindingLabel(
	keybindings: ResolvedKeybindings,
	id: string,
	options: ShownOptions = {},
): string {
	return keysLabel(keybindingKeys(keybindings, id, options), keybindings.platform);
}

export function keybindingLabels(keybindings: ResolvedKeybindings, id: string): string[] {
	return activeChords(keybindings, id).map((chord) =>
		keysLabel(shortcutKeys(displayShortcut(chord), keybindings.platform), keybindings.platform),
	);
}
