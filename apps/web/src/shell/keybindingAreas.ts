import type { KeybindingOverrides } from "@thinkrail/contracts";
import {
	type KeybindingEntry,
	type KeybindingList,
	keyChordLabel,
	parseChord,
	resetChord,
	SHORTCUT_SURFACES,
	type ShortcutSurface,
} from "../keybindings";
import type { SettingsSearchEntry } from "../panels/settingsSearch";
import { SettingsSection } from "../store";

const SHORTCUT_SETTING_PREFIX = "shortcut:";

export interface KeybindingArea {
	readonly id: string;
	readonly surface: ShortcutSurface | null;
	readonly entries: readonly KeybindingEntry[];
	readonly changed: number;
	readonly scope: string | null;
}

export interface KeybindingScopeRun {
	readonly scope: string | null;
	readonly entries: readonly KeybindingEntry[];
}

export function chordName(chord: string, platform: string): string {
	const parsed = parseChord(chord);
	return parsed ? keyChordLabel(parsed, platform) : chord;
}

function sharedScope(entries: readonly KeybindingEntry[]): string | null {
	const [first] = entries;
	const scope = first?.scope ?? null;
	return scope !== null && entries.every((entry) => entry.scope === scope) ? scope : null;
}

export function keybindingAreas(
	list: KeybindingList,
	extensions: readonly string[],
): KeybindingArea[] {
	const groups = [
		...SHORTCUT_SURFACES.map((surface) => ({
			id: surface,
			surface,
			entries: list.entries.filter((entry) => entry.surface === surface),
		})),
		...extensions.map((name) => ({
			id: name,
			surface: null,
			entries: list.entries.filter((entry) => entry.surface === null && entry.source === name),
		})),
	];
	return groups
		.filter((group) => group.entries.length > 0)
		.map((group) => ({
			...group,
			changed: group.entries.filter((entry) => entry.custom).length,
			scope: sharedScope(group.entries),
		}));
}

export function scopeRuns(entries: readonly KeybindingEntry[]): KeybindingScopeRun[] {
	const runs: { scope: string | null; entries: KeybindingEntry[] }[] = [];
	for (const entry of entries) {
		const last = runs.at(-1);
		if (last && last.scope === entry.scope) last.entries.push(entry);
		else runs.push({ scope: entry.scope, entries: [entry] });
	}
	return runs;
}

export function shortcutSettingId(entryId: string): string {
	return `${SHORTCUT_SETTING_PREFIX}${entryId}`;
}

export function areaOfSetting(
	areas: readonly KeybindingArea[],
	settingId: string | null,
): string | null {
	if (settingId === null || !settingId.startsWith(SHORTCUT_SETTING_PREFIX)) return null;
	const entryId = settingId.slice(SHORTCUT_SETTING_PREFIX.length);
	return areas.find((area) => area.entries.some((entry) => entry.id === entryId))?.id ?? null;
}

export function resetArea(
	overrides: KeybindingOverrides,
	area: KeybindingArea,
): KeybindingOverrides {
	return area.entries.reduce(
		(next, entry) => (entry.custom && !entry.locked ? resetChord(next, entry.command) : next),
		overrides,
	);
}

function shownLabels(entry: KeybindingEntry): string[] {
	const chords = [...entry.fixed, ...entry.chords];
	return [...new Set(chords.flatMap(({ label, shown }) => (shown ? [label] : [])))];
}

export function shortcutSearchEntries(
	areas: readonly KeybindingArea[],
	text: {
		readonly title: (entry: KeybindingEntry) => string;
		readonly area: (area: KeybindingArea) => string;
		readonly unbound: string;
	},
): SettingsSearchEntry[] {
	return areas.flatMap((area) =>
		area.entries.map((entry) => {
			const labels = shownLabels(entry);
			return {
				id: shortcutSettingId(entry.id),
				section: SettingsSection.Keyboard,
				label: text.title(entry),
				description: labels.length === 0 ? text.unbound : labels.join(" · "),
				keywords: [text.area(area), ...labels, "shortcut", "keybinding"],
			};
		}),
	);
}
