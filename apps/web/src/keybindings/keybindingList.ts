import type { KeybindingOverrides } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { shortcutKeys } from "../commands";
import { platformFamily } from "../lib";
import {
	chordSignature,
	chordText,
	formatChord,
	heldSignatures,
	isBrowserReservedChord,
	isDesktopNativeChord,
	isPlainChord,
	parseChord,
} from "./chord";
import { displayShortcut, type KeyChord, keysLabel, type PhysicalChord } from "./keybindings";
import type { ResolvedCommand, ResolvedKeybindings } from "./resolve";
import {
	keyChords,
	SHORTCUT_CATALOG,
	SHORTCUT_SURFACES,
	type ShortcutKey,
	type ShortcutSurface,
} from "./shortcutCatalog";

const THINKRAIL_SOURCE = "thinkrail";

export interface KeybindingEntryChord {
	readonly text: string;
	readonly keys: readonly string[];
	readonly label: string;
	readonly lostTo: string | null;
	readonly displayOnly: boolean;
	readonly shown: boolean;
}

export interface KeybindingEntry {
	readonly command: string;
	readonly title: MessageKey;
	readonly position: number | null;
	readonly source: string;
	readonly surface: ShortcutSurface | null;
	readonly locked: boolean;
	readonly active: boolean;
	readonly custom: boolean;
	readonly plain: boolean;
	readonly chords: readonly KeybindingEntryChord[];
	readonly defaults: readonly string[];
}

export interface ExtensionShortcutSet {
	readonly extension: string;
	readonly enabled: boolean;
	readonly shortcuts: readonly {
		readonly id: string;
		readonly title: MessageKey;
		readonly keys: readonly ShortcutKey[];
	}[];
}

export interface KeybindingList {
	readonly keybindings: ResolvedKeybindings;
	readonly entries: readonly KeybindingEntry[];
}

interface ListContext {
	readonly desktop: boolean;
	readonly keybindings: ResolvedKeybindings;
	readonly extensions: readonly ExtensionShortcutSet[];
}

function isApple(keybindings: ResolvedKeybindings): boolean {
	return platformFamily(keybindings.platform) === "apple";
}

export function keyChordLabel(chord: KeyChord, platform: string): string {
	return keysLabel(shortcutKeys(displayShortcut(chord), platform), platform);
}

function commandEntry(
	command: ResolvedCommand,
	place: Pick<KeybindingEntry, "title" | "position" | "source" | "surface">,
	{ desktop, keybindings }: ListContext,
): KeybindingEntry {
	const { platform } = keybindings;
	const reserved = ({ chord }: ResolvedCommand["chords"][number]) =>
		isBrowserReservedChord(chord, platform);
	const hideReserved =
		!desktop && command.chords.some((chord) => chord.lostTo === null && !reserved(chord));
	return {
		command: command.id,
		...place,
		locked: false,
		active: command.enabled,
		custom: command.custom,
		plain: command.plain,
		chords: command.chords.map((resolved) => {
			const keys = shortcutKeys(displayShortcut(resolved.chord), platform);
			return {
				text: resolved.text,
				keys,
				label: keysLabel(keys, platform),
				lostTo: resolved.lostTo,
				displayOnly: resolved.chord.displayOnly === true,
				shown: !(hideReserved && reserved(resolved)),
			};
		}),
		defaults: command.defaults.map(chordText),
	};
}

function lockedEntry(
	id: string,
	title: MessageKey,
	keys: readonly ShortcutKey[],
	place: Pick<KeybindingEntry, "source" | "surface" | "active">,
	platform: string,
): KeybindingEntry[] {
	const chords = keyChords(keys, platform);
	if (chords.length === 0) return [];
	return [
		{
			command: id,
			title,
			position: null,
			...place,
			locked: true,
			custom: false,
			plain: false,
			chords: chords.map(({ keys: caps, label }) => ({
				text: label,
				keys: caps,
				label,
				lostTo: null,
				displayOnly: false,
				shown: true,
			})),
			defaults: [],
		},
	];
}

export function keybindingList(context: ListContext): KeybindingList {
	const { desktop, keybindings, extensions } = context;
	const { platform } = keybindings;
	const thinkrail = SHORTCUT_SURFACES.flatMap((surface) =>
		SHORTCUT_CATALOG.filter((entry) => entry.surface === surface).flatMap((entry) => {
			if (entry.desktop && !desktop) return [];
			const place = { source: THINKRAIL_SOURCE, surface };
			if (entry.keys) {
				return lockedEntry(entry.id, entry.title, entry.keys, { ...place, active: true }, platform);
			}
			const many = entry.bindings.length > 1;
			return entry.bindings.flatMap((id, index) => {
				const command = keybindings.byId.get(id);
				if (command === undefined) return [];
				const title = many ? (entry.bindingTitle ?? entry.title) : entry.title;
				return [
					commandEntry(command, { ...place, title, position: many ? index + 1 : null }, context),
				];
			});
		}),
	);
	const fromExtensions = extensions.flatMap(({ extension, enabled, shortcuts }) => [
		...keybindings.commands.flatMap((command) =>
			command.extension === extension && command.title !== null
				? [
						commandEntry(
							command,
							{ title: command.title, position: null, source: extension, surface: null },
							context,
						),
					]
				: [],
		),
		...shortcuts.flatMap(({ id, title, keys }) =>
			lockedEntry(id, title, keys, { source: extension, surface: null, active: enabled }, platform),
		),
	]);
	return { keybindings, entries: [...thinkrail, ...fromExtensions] };
}

function editableEntry(list: KeybindingList, command: string): KeybindingEntry | undefined {
	return list.entries.find((entry) => entry.command === command && !entry.locked);
}

function activeHolder(
	keybindings: ResolvedKeybindings,
	command: string,
	chord: KeyChord,
): string | null {
	const apple = isApple(keybindings);
	const signature = chordSignature(chord, apple);
	return (
		keybindings.active.find(
			(active) => active.id !== command && heldSignatures(active.chord, apple).includes(signature),
		)?.id ?? null
	);
}

export function chordHolder(list: KeybindingList, command: string, chord: string): string | null {
	const pressed = parseChord(chord);
	return pressed === null ? null : activeHolder(list.keybindings, command, pressed);
}

function sameChords(a: readonly KeyChord[], b: readonly KeyChord[], apple: boolean): boolean {
	const left = new Set(a.map((chord) => chordSignature(chord, apple)));
	const right = new Set(b.map((chord) => chordSignature(chord, apple)));
	return left.size === right.size && [...left].every((signature) => right.has(signature));
}

function physical(chords: readonly KeyChord[]): PhysicalChord[] {
	return chords.flatMap((chord) => (chord.typed || chord.displayOnly ? [] : [chord]));
}

function overrideValue(
	command: ResolvedCommand,
	chords: readonly PhysicalChord[],
	apple: boolean,
): string[] | null {
	const defaults = command.defaults.filter((chord) => !chord.displayOnly);
	return sameChords(chords, defaults, apple) ? null : chords.map((chord) => formatChord(chord));
}

function withOverride(
	overrides: KeybindingOverrides,
	id: string,
	value: string[] | null,
): KeybindingOverrides {
	const next = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id));
	return value === null ? next : { ...next, [id]: value };
}

function withoutChords(
	overrides: KeybindingOverrides,
	command: ResolvedCommand,
	removed: readonly KeyChord[],
	apple: boolean,
): KeybindingOverrides {
	const gone = new Set(removed.map((chord) => chordSignature(chord, apple)));
	const kept = physical(command.chords.map(({ chord }) => chord)).filter(
		(chord) => !gone.has(chordSignature(chord, apple)),
	);
	return withOverride(overrides, command.id, overrideValue(command, kept, apple));
}

export function assignChord(
	list: KeybindingList,
	overrides: KeybindingOverrides,
	command: string,
	chord: string,
	replace: string | null = null,
): KeybindingOverrides {
	const target = list.keybindings.byId.get(command);
	const pressed = parseChord(chord);
	if (target === undefined || pressed === null) return overrides;
	const apple = isApple(list.keybindings);
	const assigned = withOverride(overrides, command, overrideValue(target, [pressed], apple));
	const other = replace === null ? undefined : list.keybindings.byId.get(replace);
	return other === undefined ? assigned : withoutChords(assigned, other, [pressed], apple);
}

export function resetChord(overrides: KeybindingOverrides, command: string): KeybindingOverrides {
	return withOverride(overrides, command, null);
}

const KEYBINDINGS_FILE_FORMAT = "thinkrail-keybindings";
const KEYBINDINGS_FILE_VERSION = 1;

export interface KeybindingFileBinding {
	readonly command: string;
	readonly title: string;
	readonly source: string;
	readonly chords?: readonly string[];
	readonly defaults?: readonly string[];
	readonly changed?: boolean;
	readonly locked?: true;
	readonly keys?: readonly string[];
	readonly active?: false;
	readonly conflict?: { readonly chord: string; readonly winner: string };
}

export interface KeybindingsFile {
	readonly format: typeof KEYBINDINGS_FILE_FORMAT;
	readonly version: typeof KEYBINDINGS_FILE_VERSION;
	readonly bindings: readonly KeybindingFileBinding[];
}

export function keybindingsFile(
	list: KeybindingList,
	title: (entry: KeybindingEntry) => string,
): KeybindingsFile {
	return {
		format: KEYBINDINGS_FILE_FORMAT,
		version: KEYBINDINGS_FILE_VERSION,
		bindings: list.entries.map((entry): KeybindingFileBinding => {
			const base = { command: entry.command, title: title(entry), source: entry.source };
			const inactive = entry.active ? {} : { active: false as const };
			if (entry.locked) {
				return { ...base, locked: true, keys: entry.chords.map(({ label }) => label), ...inactive };
			}
			const lost = entry.chords.find(({ lostTo }) => lostTo !== null);
			return {
				...base,
				chords: entry.chords.map(({ text }) => text),
				defaults: entry.defaults,
				changed: entry.custom,
				...inactive,
				...(lost?.lostTo ? { conflict: { chord: lost.text, winner: lost.lostTo } } : {}),
			};
		}),
	};
}

export type ImportSkipReason = "locked" | "unknown" | "invalid" | "plain" | "desktop";

export interface ImportChange {
	readonly command: string;
	readonly from: readonly string[];
	readonly to: readonly string[];
}

export interface ImportConflict {
	readonly chord: string;
	readonly command: string;
	readonly other: string;
}

export interface ImportSkip {
	readonly command: string;
	readonly reason: ImportSkipReason;
}

export interface ImportPlan {
	readonly changes: readonly ImportChange[];
	readonly conflicts: readonly ImportConflict[];
	readonly skipped: readonly ImportSkip[];
	readonly unchanged: number;
	readonly overrides: KeybindingOverrides;
}

type ImportTarget =
	| { readonly kind: "unchanged" }
	| { readonly kind: "skip"; readonly reason: ImportSkipReason }
	| {
			readonly kind: "set";
			readonly chords: readonly KeyChord[];
			readonly value: string[] | null;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? [...new Set(value)]
		: null;
}

function sameTexts(a: readonly string[], b: readonly string[] | null): boolean {
	return b !== null && a.length === new Set(b).size && a.every((text) => b.includes(text));
}

function importTarget(
	entry: KeybindingEntry,
	command: ResolvedCommand,
	binding: Record<string, unknown>,
	apple: boolean,
): ImportTarget {
	const chords = stringList(binding.chords);
	if (chords === null) return { kind: "skip", reason: "invalid" };
	if (
		sameTexts(
			chords,
			entry.chords.map(({ text }) => text),
		)
	)
		return { kind: "unchanged" };
	if (sameTexts(chords, entry.defaults) || sameTexts(chords, stringList(binding.defaults))) {
		return entry.custom
			? { kind: "set", chords: command.defaults, value: null }
			: { kind: "unchanged" };
	}
	const parsed: PhysicalChord[] = [];
	for (const text of chords) {
		const chord = parseChord(text);
		if (chord === null) return { kind: "skip", reason: "invalid" };
		if (!entry.plain && isPlainChord(chord)) return { kind: "skip", reason: "plain" };
		if (isDesktopNativeChord(chord)) return { kind: "skip", reason: "desktop" };
		if (!parsed.some((other) => chordSignature(other, apple) === chordSignature(chord, apple))) {
			parsed.push(chord);
		}
	}
	const value = overrideValue(command, parsed, apple);
	if (value === null && !entry.custom) return { kind: "unchanged" };
	if (
		value !== null &&
		entry.custom &&
		sameChords(parsed, physical(command.chords.map(({ chord }) => chord)), apple)
	) {
		return { kind: "unchanged" };
	}
	return { kind: "set", chords: value === null ? command.defaults : parsed, value };
}

function isKeybindingsFile(file: unknown): file is Record<string, unknown> & {
	bindings: unknown[];
} {
	return (
		isRecord(file) &&
		file.format === KEYBINDINGS_FILE_FORMAT &&
		file.version === KEYBINDINGS_FILE_VERSION &&
		Array.isArray(file.bindings)
	);
}

export function planImport(
	overrides: KeybindingOverrides,
	list: KeybindingList,
	file: unknown,
): ImportPlan | null {
	if (!isKeybindingsFile(file)) return null;
	const { keybindings } = list;
	const apple = isApple(keybindings);
	const locked = new Set([
		...SHORTCUT_CATALOG.flatMap(({ id, keys }) => (keys ? [id] : [])),
		...list.entries.flatMap(({ command, locked: isLocked }) => (isLocked ? [command] : [])),
	]);
	const changes: ImportChange[] = [];
	const skipped: ImportSkip[] = [];
	const targets = new Map<string, readonly KeyChord[]>();
	let unchanged = 0;
	let next = overrides;
	for (const binding of file.bindings) {
		const id = isRecord(binding) && typeof binding.command === "string" ? binding.command : "";
		if (!isRecord(binding) || id === "") {
			skipped.push({ command: id, reason: "invalid" });
			continue;
		}
		if (locked.has(id)) {
			skipped.push({ command: id, reason: "locked" });
			continue;
		}
		const entry = editableEntry(list, id);
		const command = keybindings.byId.get(id);
		if (entry === undefined || command === undefined || targets.has(id)) {
			skipped.push({ command: id, reason: "unknown" });
			continue;
		}
		const target = importTarget(entry, command, binding, apple);
		if (target.kind === "unchanged") unchanged += 1;
		else if (target.kind === "skip") skipped.push({ command: id, reason: target.reason });
		else {
			targets.set(id, target.chords);
			next = withOverride(next, id, target.value);
			changes.push({
				command: id,
				from: entry.chords.map(({ label }) => label),
				to: target.chords.map((chord) => keyChordLabel(chord, keybindings.platform)),
			});
		}
	}
	const conflicts: ImportConflict[] = [];
	const removed = new Map<string, KeyChord[]>();
	for (const [id, chords] of targets) {
		if (keybindings.byId.get(id)?.enabled !== true) continue;
		for (const chord of physical(chords)) {
			const holder = activeHolder(keybindings, id, chord);
			if (holder === null || targets.has(holder)) continue;
			conflicts.push({
				chord: keyChordLabel(chord, keybindings.platform),
				command: id,
				other: holder,
			});
			removed.set(holder, [...(removed.get(holder) ?? []), chord]);
		}
	}
	for (const [id, chords] of removed) {
		const other = keybindings.byId.get(id);
		if (other !== undefined) next = withoutChords(next, other, chords, apple);
	}
	return { changes, conflicts, skipped, unchanged, overrides: next };
}
