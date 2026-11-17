import type { MessageKey } from "@thinkrail/locales";
import { isTypingChord, keyCap, twinArrow } from "@thinkrail/ui/keyboard";
import { type CommandShortcut, shortcutKeys } from "../commands";
import { platformFamily } from "../lib";
import {
	chordSignature,
	chordText,
	formatChord,
	heldSignatures,
	isBrowserReservedChord,
	isLockedPrimitive,
	isPlainChord,
	parseChord,
	reservedChordOwner,
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
import {
	APP_LOCAL_COMMANDS,
	APP_LOCAL_SCOPES,
	type LocalCommandDefaults,
	type LocalScopeDeclaration,
} from "./localKeys";

export interface ExtensionCommandDefaults {
	readonly id: string;
	readonly title: MessageKey;
	readonly scope?: string | undefined;
	readonly chords: readonly PhysicalChord[];
}

export interface ExtensionCommandSet {
	readonly extension: string;
	readonly enabled: boolean;
	readonly commands: readonly ExtensionCommandDefaults[];
}

export interface LocalCommandSet {
	readonly source: string;
	readonly enabled: boolean;
	readonly scopes?: readonly LocalScopeDeclaration[];
	readonly commands: readonly LocalCommandDefaults[];
}

export const THINKRAIL_SOURCE = "thinkrail";

export const APP_LOCAL_SET: LocalCommandSet = {
	source: THINKRAIL_SOURCE,
	enabled: true,
	scopes: APP_LOCAL_SCOPES,
	commands: APP_LOCAL_COMMANDS,
};

export interface KeybindingsInput {
	readonly platform: string;
	readonly overrides?: Readonly<Record<string, readonly string[]>>;
	readonly extensions?: readonly ExtensionCommandSet[];
	readonly local?: readonly LocalCommandSet[];
	readonly table?: Readonly<Record<string, readonly KeyChord[]>>;
}

export interface LostIn {
	readonly scope: string;
	readonly winner: string;
}

export interface ResolvedChord {
	readonly chord: KeyChord;
	readonly text: string;
	readonly lostTo: string | null;
	readonly lostIn: readonly LostIn[];
}

export interface ResolvedCommand {
	readonly id: string;
	readonly extension: string | null;
	readonly title: MessageKey | null;
	readonly scope: string | null;
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
	readonly scope: string | null;
}

interface ActiveChord {
	readonly id: string;
	readonly chord: KeyChord;
}

export interface LocalActiveChord {
	readonly id: string;
	readonly chord: PhysicalChord;
}

export interface ResolvedKeybindings {
	readonly platform: string;
	readonly commands: readonly ResolvedCommand[];
	readonly byId: ReadonlyMap<string, ResolvedCommand>;
	readonly conflicts: readonly KeybindingConflict[];
	readonly active: readonly ActiveChord[];
	readonly local: ReadonlyMap<string, readonly LocalActiveChord[]>;
	readonly includes: ReadonlyMap<string, readonly string[]>;
	readonly extendsWithShift: ReadonlySet<string>;
}

interface Draft {
	readonly id: string;
	readonly extension: string | null;
	readonly title: MessageKey | null;
	readonly scope: string | null;
	readonly enabled: boolean;
	readonly custom: boolean;
	readonly plain: boolean;
	readonly chords: readonly KeyChord[];
	readonly defaults: readonly KeyChord[];
	readonly lostTo: Map<number, string>;
	readonly lostIn: Map<number, LostIn[]>;
}

interface Candidate {
	readonly id: string;
	readonly extension: string | null;
	readonly title: MessageKey | null;
	readonly scope: string | null;
	readonly enabled: boolean;
	readonly defaults: readonly KeyChord[];
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

function namespaced(extension: string, id: string, scope: string | null): boolean {
	const prefix = `${extension}.`;
	return id.startsWith(prefix) && (scope === null || scope.startsWith(prefix));
}

function validDefaults(chords: readonly PhysicalChord[]): PhysicalChord[] {
	return chords.flatMap((chord) =>
		parseChord(formatChord(chord)) ? [{ ...chord, key: keyCap(chord.key) }] : [],
	);
}

function commandCandidates(
	extension: string | null,
	enabled: boolean,
	commands: readonly (ExtensionCommandDefaults | LocalCommandDefaults)[],
): Candidate[] {
	return commands.flatMap((command) => {
		const scope = command.scope ?? null;
		if (extension !== null && !namespaced(extension, command.id, scope)) return [];
		const defaults = validDefaults(command.chords);
		return [{ id: command.id, extension, title: command.title, scope, enabled, defaults }];
	});
}

function candidates(
	table: Readonly<Record<string, readonly KeyChord[]>>,
	local: readonly LocalCommandSet[],
	extensions: readonly ExtensionCommandSet[],
): Candidate[] {
	return [
		...Object.entries(table).map(
			([id, defaults]): Candidate => ({
				id,
				extension: null,
				title: null,
				scope: null,
				enabled: true,
				defaults,
			}),
		),
		...local.flatMap(({ source, enabled, commands }) =>
			commandCandidates(source === THINKRAIL_SOURCE ? null : source, enabled, commands),
		),
		...extensions.flatMap(({ extension, enabled, commands }) =>
			commandCandidates(extension, enabled, commands),
		),
	];
}

function scopeIncludes(
	local: readonly LocalCommandSet[],
	drafts: readonly Draft[],
): Map<string, readonly string[]> {
	const includes = new Map<string, readonly string[]>();
	for (const { scopes = [] } of local) {
		for (const { id, includes: included = [] } of scopes) {
			if (!includes.has(id)) includes.set(id, included);
		}
	}
	for (const { scope } of drafts) {
		if (scope !== null && !includes.has(scope)) includes.set(scope, []);
	}
	const shared = new Set([...includes.values()].flat());
	return new Map([...includes].filter(([id]) => !shared.has(id)));
}

export function resolveKeybindings({
	platform,
	overrides = {},
	extensions = [],
	local = [APP_LOCAL_SET],
	table = KEYBINDINGS,
}: KeybindingsInput): ResolvedKeybindings {
	const apple = platformFamily(platform) === "apple";
	const drafts: Draft[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates(table, local, extensions)) {
		const { id, defaults } = candidate;
		if (seen.has(id)) continue;
		seen.add(id);
		const plain = candidate.scope !== null || defaults.some(isPlainChord);
		const override = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
		const platformDefaults = defaults.filter((chord) => onPlatform(chord, apple));
		const ownDefault = (chord: KeyChord) =>
			platformDefaults.some(
				(other) => chordSignature(other, apple) === chordSignature(chord, apple),
			);
		const chords = Array.isArray(override)
			? override.flatMap((text) => {
					const chord = parseChord(text);
					return chord &&
						(plain || !isPlainChord(chord)) &&
						(!isLockedPrimitive(chord) || ownDefault(chord))
						? [chord]
						: [];
				})
			: platformDefaults;
		drafts.push({
			...candidate,
			custom: Array.isArray(override),
			plain,
			chords: distinct(chords, apple),
			defaults: platformDefaults,
			lostTo: new Map(),
			lostIn: new Map(),
		});
	}

	const owners = new Map<string, string>();
	for (const [id, chords] of Object.entries(table)) {
		for (const chord of chords) {
			if (chord.displayOnly && onPlatform(chord, apple))
				owners.set(chordSignature(chord, apple), id);
		}
	}
	const active: ActiveChord[] = [];
	const conflicts: KeybindingConflict[] = [];
	const lose = (draft: Draft, index: number, chord: KeyChord, winner: string) => {
		draft.lostTo.set(index, winner);
		conflicts.push({ loser: draft.id, chord: chordText(chord), winner, scope: draft.scope });
	};
	const ranked = drafts
		.filter((draft) => draft.enabled)
		.map((draft, order) => ({ draft, order }))
		.sort((a, b) => rank(a.draft) - rank(b.draft) || a.order - b.order);
	for (const { draft } of ranked) {
		if (draft.scope !== null) continue;
		draft.chords.forEach((chord, index) => {
			const held = heldSignatures(chord, apple);
			const owner =
				held.map((signature) => owners.get(signature)).find((id) => id !== undefined) ??
				reservedChordOwner(chord, draft.custom ? undefined : apple);
			if (owner === draft.id) return;
			if (owner === null) {
				for (const signature of held) owners.set(signature, draft.id);
				if (!chord.displayOnly) active.push({ id: draft.id, chord });
				return;
			}
			lose(draft, index, chord, owner);
		});
	}

	for (const { draft } of ranked) {
		if (draft.scope === null) continue;
		draft.chords.forEach((chord, index) => {
			const owner = reservedChordOwner(chord, draft.custom ? undefined : apple);
			if (owner !== null) lose(draft, index, chord, owner);
		});
	}
	const includes = scopeIncludes(local, drafts);
	const localActive = new Map<string, LocalActiveChord[]>();
	for (const [scope, included] of includes) {
		const scoped: LocalActiveChord[] = [];
		const held = new Map<string, string>();
		const members = ranked
			.filter(({ draft }) => draft.scope === scope || included.includes(draft.scope ?? ""))
			.sort(
				(a, b) =>
					rank(a.draft) - rank(b.draft) ||
					Number(a.draft.scope !== scope) - Number(b.draft.scope !== scope) ||
					a.order - b.order,
			);
		for (const { draft } of members) {
			draft.chords.forEach((chord, index) => {
				if (chord.typed || draft.lostTo.has(index)) return;
				const signature = chordSignature(chord, apple);
				const owner = held.get(signature);
				if (owner === undefined) {
					held.set(signature, draft.id);
					scoped.push({ id: draft.id, chord });
					return;
				}
				if (draft.scope === scope) draft.lostTo.set(index, owner);
				else
					draft.lostIn.set(index, [...(draft.lostIn.get(index) ?? []), { scope, winner: owner }]);
				conflicts.push({ loser: draft.id, chord: chordText(chord), winner: owner, scope });
			});
		}
		localActive.set(scope, scoped);
	}

	const commands = drafts.map(
		({ lostTo, lostIn, chords, ...command }): ResolvedCommand => ({
			...command,
			chords: chords.map((chord, index) => ({
				chord,
				text: chordText(chord),
				lostTo: lostTo.get(index) ?? null,
				lostIn: lostIn.get(index) ?? [],
			})),
		}),
	);
	return {
		platform,
		commands,
		byId: new Map(commands.map((command) => [command.id, command])),
		conflicts,
		active,
		local: localActive,
		includes,
		extendsWithShift: new Set(
			local.flatMap(({ scopes = [] }) =>
				scopes.flatMap(({ id, extendsWithShift }) => (extendsWithShift ? [id] : [])),
			),
		),
	};
}

export function matchKeybinding(
	keybindings: ResolvedKeybindings,
	event: KeybindingEvent,
	{ textEntry = true }: { textEntry?: boolean } = {},
): string | null {
	for (const { id, chord } of keybindings.active) {
		if (textEntry && isPlainChord(chord)) continue;
		if (pressed(chord, event, keybindings.platform)) return id;
	}
	return null;
}

export function matchLocal(
	keybindings: ResolvedKeybindings,
	scopes: readonly string[],
	event: KeybindingEvent,
	{ textEntry = false }: { textEntry?: boolean } = {},
): string | null {
	const { platform } = keybindings;
	for (const scope of scopes) {
		const held = (keybindings.local.get(scope) ?? []).filter(
			({ chord }) => !(textEntry && isTypingChord(chord)),
		);
		const exact = held.find(({ chord }) => pressed(chord, event, platform));
		if (exact) return exact.id;
		if (!event.shiftKey || !keybindings.extendsWithShift.has(scope)) continue;
		const extended = held.find(
			({ id, chord }) =>
				twinArrow(id) !== undefined && pressed(chord, event, platform, { ignoreShift: true }),
		);
		if (extended) return extended.id;
	}
	return null;
}

function signatureOf(keybindings: ResolvedKeybindings, chord: string): string | null {
	const parsed = parseChord(chord);
	return parsed === null
		? null
		: chordSignature(parsed, platformFamily(keybindings.platform) === "apple");
}

export interface LocalUse {
	readonly scope: string;
	readonly command: string;
}

export function localUses(keybindings: ResolvedKeybindings, chord: string): LocalUse[] {
	const signature = signatureOf(keybindings, chord);
	if (signature === null) return [];
	const apple = platformFamily(keybindings.platform) === "apple";
	return [...keybindings.local].flatMap(([scope, active]) =>
		active.flatMap((held) =>
			chordSignature(held.chord, apple) === signature ? [{ scope, command: held.id }] : [],
		),
	);
}

export function globalHolder(keybindings: ResolvedKeybindings, chord: string): string | null {
	const signature = signatureOf(keybindings, chord);
	if (signature === null) return null;
	const apple = platformFamily(keybindings.platform) === "apple";
	return (
		keybindings.active.find((held) => heldSignatures(held.chord, apple).includes(signature))?.id ??
		null
	);
}

export function lostHere(chord: ResolvedChord, scope: string | null): string | null {
	return chord.lostTo ?? chord.lostIn.find((lost) => lost.scope === scope)?.winner ?? null;
}

export function actsIn(keybindings: ResolvedKeybindings, scope: string): string[] {
	return [...keybindings.includes].flatMap(([element, included]) =>
		element === scope || included.includes(scope) ? [element] : [],
	);
}

export function pressesChord(
	event: KeybindingEvent,
	chords: readonly KeyChord[],
	platform: string,
): boolean {
	return chords.some((chord) => pressed(chord, event, platform));
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
