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
	isLockedPrimitive,
	isPlainChord,
	parseChord,
} from "./chord";
import { displayShortcut, type KeyChord, keysLabel, type PhysicalChord } from "./keybindings";
import {
	actsIn,
	localUses,
	lostHere,
	type ResolvedCommand,
	type ResolvedKeybindings,
	THINKRAIL_SOURCE,
} from "./resolve";
import {
	keyChords,
	localIds,
	SHORTCUT_CATALOG,
	SHORTCUT_SURFACES,
	type ShortcutCatalogEntry,
	type ShortcutKey,
	type ShortcutSurface,
} from "./shortcutCatalog";

export interface KeybindingEntryChord {
	readonly text: string;
	readonly keys: readonly string[];
	readonly label: string;
	readonly lostTo: string | null;
	readonly displayOnly: boolean;
	readonly shown: boolean;
}

export interface KeybindingYield {
	readonly scope: string;
	readonly label: string;
	readonly winner: string;
}

export interface KeybindingEntry {
	readonly id: string;
	readonly command: string;
	readonly title: MessageKey;
	readonly position: number | null;
	readonly source: string;
	readonly surface: ShortcutSurface | null;
	readonly scope: string | null;
	readonly locked: boolean;
	readonly active: boolean;
	readonly custom: boolean;
	readonly plain: boolean;
	readonly fixed: readonly KeybindingEntryChord[];
	readonly chords: readonly KeybindingEntryChord[];
	readonly defaults: readonly string[];
	readonly yields: readonly KeybindingYield[];
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

type EntryPlace = Pick<KeybindingEntry, "id" | "title" | "position" | "source" | "surface"> & {
	readonly scope?: string | null;
	readonly fixed?: readonly ShortcutKey[];
	readonly shift?: boolean;
};

function fixedChords(keys: readonly ShortcutKey[], platform: string): KeybindingEntryChord[] {
	return keyChords(keys, platform).map(({ keys: caps, label }) => ({
		text: label,
		keys: caps,
		label,
		lostTo: null,
		displayOnly: false,
		shown: true,
	}));
}

function commandYields(
	command: ResolvedCommand,
	scope: string | null,
	keybindings: ResolvedKeybindings,
): KeybindingYield[] {
	const { platform } = keybindings;
	return command.chords.flatMap(({ chord, text, lostTo, lostIn }) => {
		if (lostTo !== null) return [];
		const label = keyChordLabel(chord, platform);
		if (command.scope === null) {
			return localUses(keybindings, text).map((use) => ({
				scope: use.scope,
				label,
				winner: use.command,
			}));
		}
		return lostIn.flatMap((lost) =>
			lost.scope === scope ? [] : [{ scope: lost.scope, label, winner: lost.winner }],
		);
	});
}

function commandEntry(
	command: ResolvedCommand,
	{ fixed = [], shift = false, scope = command.scope, ...place }: EntryPlace,
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
		scope,
		locked: shift,
		active: command.enabled,
		custom: command.custom,
		plain: command.plain,
		fixed: fixedChords(fixed, platform),
		chords: command.chords.map((resolved) => {
			const keys = shortcutKeys(
				{ ...displayShortcut(resolved.chord), ...(shift ? { shift: true } : {}) },
				platform,
			);
			return {
				text: resolved.text,
				keys,
				label: keysLabel(keys, platform),
				lostTo: lostHere(resolved, scope),
				displayOnly: resolved.chord.displayOnly === true,
				shown: !(hideReserved && reserved(resolved)),
			};
		}),
		defaults: command.defaults.map(chordText),
		yields: shift ? [] : commandYields(command, scope, keybindings),
	};
}

function lockedEntry(
	id: string,
	title: MessageKey,
	keys: readonly ShortcutKey[],
	place: Pick<KeybindingEntry, "source" | "surface" | "active" | "scope">,
	platform: string,
): KeybindingEntry[] {
	const chords = fixedChords(keys, platform);
	if (chords.length === 0) return [];
	return [
		{
			id,
			command: id,
			title,
			position: null,
			...place,
			locked: true,
			custom: false,
			plain: false,
			fixed: [],
			chords,
			defaults: [],
			yields: [],
		},
	];
}

function catalogEntries(
	entry: ShortcutCatalogEntry,
	surface: ShortcutSurface,
	context: ListContext,
): KeybindingEntry[] {
	const { keybindings } = context;
	const { platform } = keybindings;
	const source = THINKRAIL_SOURCE;
	const place = { id: entry.id, title: entry.title, position: null, source, surface };
	if (entry.local !== undefined) {
		const ids = localIds(entry);
		const many = ids.length > 1;
		const title = many ? (entry.bindingTitle ?? entry.title) : entry.title;
		return ids.flatMap((id, index) => {
			const command = keybindings.byId.get(id);
			if (command === undefined) return [];
			const at = many ? { id, title, position: index + 1 } : {};
			return [commandEntry(command, { ...place, ...at, fixed: entry.keys ?? [] }, context)];
		});
	}
	if (entry.keys) {
		const scope = entry.scope ?? null;
		const twin = entry.twin && keybindings.byId.get(entry.twin.command);
		if (entry.twin === undefined || twin === undefined) {
			return lockedEntry(
				entry.id,
				entry.title,
				entry.keys,
				{ ...place, active: true, scope },
				platform,
			);
		}
		const shift = entry.twin.shift === true;
		return [commandEntry(twin, { ...place, scope, fixed: entry.keys, shift }, context)];
	}
	const many = entry.bindings.length > 1;
	return entry.bindings.flatMap((id, index) => {
		const command = keybindings.byId.get(id);
		if (command === undefined) return [];
		const title = many ? (entry.bindingTitle ?? entry.title) : entry.title;
		return [
			commandEntry(command, { ...place, id, title, position: many ? index + 1 : null }, context),
		];
	});
}

export function keybindingList(context: ListContext): KeybindingList {
	const { desktop, keybindings, extensions } = context;
	const { platform } = keybindings;
	const thinkrail = SHORTCUT_SURFACES.flatMap((surface) =>
		SHORTCUT_CATALOG.filter((entry) => entry.surface === surface).flatMap((entry) =>
			entry.desktop && !desktop ? [] : catalogEntries(entry, surface, context),
		),
	);
	const fromExtensions = extensions.flatMap(({ extension, enabled, shortcuts }) => [
		...keybindings.commands.flatMap((command) =>
			command.extension === extension && command.title !== null
				? [
						commandEntry(
							command,
							{
								id: command.id,
								title: command.title,
								position: null,
								source: extension,
								surface: null,
							},
							context,
						),
					]
				: [],
		),
		...shortcuts.flatMap(({ id, title, keys }) =>
			lockedEntry(
				id,
				title,
				keys,
				{ source: extension, surface: null, active: enabled, scope: null },
				platform,
			),
		),
	]);
	return { keybindings, entries: [...thinkrail, ...fromExtensions] };
}

function editableEntry(list: KeybindingList, id: string): KeybindingEntry | undefined {
	return list.entries.find((entry) => entry.id === id && !entry.locked);
}

export interface ChordHolder {
	readonly command: string;
	readonly scope: string | null;
}

function holdersOf(
	keybindings: ResolvedKeybindings,
	command: string,
	chord: KeyChord,
): ChordHolder[] {
	const target = keybindings.byId.get(command);
	if (target?.enabled !== true) return [];
	const apple = isApple(keybindings);
	const signature = chordSignature(chord, apple);
	const held: ChordHolder[] =
		target.scope === null
			? keybindings.active
					.filter((active) => heldSignatures(active.chord, apple).includes(signature))
					.map((active) => ({ command: active.id, scope: null }))
			: actsIn(keybindings, target.scope).flatMap((scope) =>
					(keybindings.local.get(scope) ?? [])
						.filter((active) => chordSignature(active.chord, apple) === signature)
						.map((active) => ({ command: active.id, scope })),
				);
	return held.filter(
		(holder, index) =>
			holder.command !== command &&
			held.findIndex((other) => other.command === holder.command) === index,
	);
}

export function chordHolders(list: KeybindingList, command: string, chord: string): ChordHolder[] {
	const pressed = parseChord(chord);
	return pressed === null ? [] : holdersOf(list.keybindings, command, pressed);
}

function includedBy(keybindings: ResolvedKeybindings, command: string, other: string): boolean {
	const scope = keybindings.byId.get(command)?.scope ?? null;
	const otherScope = keybindings.byId.get(other)?.scope ?? null;
	return (
		scope !== null &&
		otherScope !== null &&
		otherScope !== scope &&
		(keybindings.includes.get(scope) ?? []).includes(otherScope)
	);
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
	contested = false,
): string[] | null {
	const defaults = command.defaults.filter((chord) => !chord.displayOnly);
	return !contested && sameChords(chords, defaults, apple)
		? null
		: chords.map((chord) => formatChord(chord));
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
	replace = false,
): KeybindingOverrides {
	const { keybindings } = list;
	const target = keybindings.byId.get(command);
	const pressed = parseChord(chord);
	if (target === undefined || pressed === null) return overrides;
	const apple = isApple(keybindings);
	const holders = holdersOf(keybindings, command, pressed);
	const replaced = replace
		? holders.filter((holder) => !includedBy(keybindings, command, holder.command))
		: [];
	const contested = holders.length > replaced.length;
	let next = withOverride(overrides, command, overrideValue(target, [pressed], apple, contested));
	for (const holder of replaced) {
		const other = keybindings.byId.get(holder.command);
		if (other !== undefined) next = withoutChords(next, other, [pressed], apple);
	}
	return next;
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
	readonly scope?: string;
	readonly alias?: string;
	readonly fixed?: { readonly keys: readonly string[]; readonly locked: true };
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
			const base = {
				command: entry.id,
				title: title(entry),
				source: entry.source,
				...(entry.scope === null ? {} : { scope: entry.scope }),
			};
			const inactive = entry.active ? {} : { active: false as const };
			if (entry.locked) {
				const keys = [...entry.fixed, ...entry.chords].map(({ label }) => label);
				return { ...base, locked: true, keys, ...inactive };
			}
			const lost = entry.chords.find(({ lostTo }) => lostTo !== null);
			return {
				...base,
				...(entry.id === entry.command ? {} : { alias: entry.command }),
				...(entry.fixed.length === 0
					? {}
					: { fixed: { keys: entry.fixed.map(({ label }) => label), locked: true as const } }),
				chords: entry.chords.map(({ text }) => text),
				defaults: entry.defaults,
				changed: entry.custom,
				...inactive,
				...(lost?.lostTo ? { conflict: { chord: lost.text, winner: lost.lostTo } } : {}),
			};
		}),
	};
}

export type ImportSkipReason = "locked" | "unknown" | "invalid" | "plain" | "primitive" | "desktop";

export interface ImportChange {
	readonly command: string;
	readonly from: readonly string[];
	readonly to: readonly string[];
}

export interface ImportConflict {
	readonly chord: string;
	readonly command: string;
	readonly other: string;
	readonly scope: string | null;
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
		if (
			isLockedPrimitive(chord) &&
			!command.defaults.some((own) => sameChords([own], [chord], apple))
		)
			return { kind: "skip", reason: "primitive" };
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
		...SHORTCUT_CATALOG.flatMap(({ id, keys, twin }) =>
			keys && (twin === undefined || twin.shift) ? [id] : [],
		),
		...list.entries.flatMap(({ id, locked: isLocked }) => (isLocked ? [id] : [])),
	]);
	const changes: ImportChange[] = [];
	const skipped: ImportSkip[] = [];
	const targets = new Map<string, readonly KeyChord[]>();
	const seen = new Set<string>();
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
		const command = entry && keybindings.byId.get(entry.command);
		if (entry === undefined || command === undefined || seen.has(id)) {
			skipped.push({ command: id, reason: "unknown" });
			continue;
		}
		seen.add(id);
		const target = importTarget(entry, command, binding, apple);
		const repeat = targets.get(command.id);
		if (target.kind === "unchanged") unchanged += 1;
		else if (target.kind === "skip") skipped.push({ command: id, reason: target.reason });
		else if (repeat !== undefined) {
			if (sameChords(repeat, target.chords, apple)) unchanged += 1;
			else skipped.push({ command: id, reason: "unknown" });
		} else {
			targets.set(command.id, target.chords);
			next = withOverride(next, command.id, target.value);
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
		const assigned = physical(chords);
		let contested = false;
		for (const chord of assigned) {
			for (const holder of holdersOf(keybindings, id, chord)) {
				if (targets.has(holder.command)) continue;
				conflicts.push({
					chord: keyChordLabel(chord, keybindings.platform),
					command: id,
					other: holder.command,
					scope: holder.scope,
				});
				if (includedBy(keybindings, id, holder.command)) contested = true;
				else removed.set(holder.command, [...(removed.get(holder.command) ?? []), chord]);
			}
		}
		if (contested && !Object.hasOwn(next, id)) {
			next = { ...next, [id]: assigned.map((chord) => formatChord(chord)) };
		}
	}
	for (const [id, chords] of removed) {
		const other = keybindings.byId.get(id);
		if (other !== undefined) next = withoutChords(next, other, chords, apple);
	}
	return { changes, conflicts, skipped, unchanged, overrides: next };
}
