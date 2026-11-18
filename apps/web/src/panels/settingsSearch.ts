import {
	type MatchField,
	type MatchRange,
	type MatchResult,
	matchFields,
	parseMatchTerms,
} from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import { SettingsSection } from "@/store";
import { availableSettings, type SettingsCatalogContext } from "./settingsCatalog";
import type { SettingsNavGroup } from "./settingsNav";

export type SettingsSearchEntry = {
	id: string;
	section: SettingsSection;
	label: string;
	description?: string;
	keywords?: string[];
};

export type SettingsSearchField = "label" | "description" | "section";

export interface SettingsSearchResult {
	readonly entry: SettingsSearchEntry;
	readonly sectionLabel: string;
	readonly ranges: Readonly<Partial<Record<SettingsSearchField, readonly MatchRange[]>>>;
}

export function settingsSectionLabels(
	t: Translator,
	groups: readonly SettingsNavGroup[],
): ReadonlyMap<SettingsSection, string> {
	return new Map([
		...groups.flatMap((group) =>
			group.sections.map((section) => [section.id, t(section.label)] as const),
		),
		[SettingsSection.Feedback, t("settings.dialog.feedbackCta")] as const,
	]);
}

export function settingsSearchEntries(
	t: Translator,
	groups: readonly SettingsNavGroup[],
	context: SettingsCatalogContext,
	injected: readonly SettingsSearchEntry[] = [],
): SettingsSearchEntry[] {
	const sections = new Set(settingsSectionLabels(t, groups).keys());
	return [
		...availableSettings(groups, context).map(
			(entry): SettingsSearchEntry => ({
				id: entry.id,
				section: entry.section,
				label: t(entry.label),
				...(entry.description === undefined ? {} : { description: t(entry.description) }),
				...(entry.keywords === undefined ? {} : { keywords: [...entry.keywords] }),
			}),
		),
		...injected.filter((entry) => sections.has(entry.section)),
	];
}

function fieldsOf(entry: SettingsSearchEntry, sectionLabel: string): MatchField[] {
	const fields: MatchField[] = [{ key: "label", text: entry.label }];
	if (entry.description) {
		fields.push({ key: "description", text: entry.description, secondary: true });
	}
	fields.push({ key: "section", text: sectionLabel, secondary: true });
	if (entry.keywords?.length) {
		fields.push({ key: "keywords", text: entry.keywords.join(" "), secondary: true });
	}
	return fields;
}

const SHOWN_FIELDS: readonly string[] = [
	"label",
	"description",
	"section",
] satisfies readonly SettingsSearchField[];

const isShownField = (key: string): key is SettingsSearchField => SHOWN_FIELDS.includes(key);

export function searchSettings(
	query: string,
	entries: readonly SettingsSearchEntry[],
	sectionLabels: ReadonlyMap<SettingsSection, string>,
): SettingsSearchResult[] {
	const terms = parseMatchTerms(query);
	if (terms.length === 0) return [];
	const order = [...sectionLabels.keys()];
	const rank = (section: SettingsSection) => {
		const index = order.indexOf(section);
		return index < 0 ? order.length : index;
	};
	const hits: { entry: SettingsSearchEntry; label: string; match: MatchResult; index: number }[] =
		[];
	for (const [index, entry] of entries.entries()) {
		const label = sectionLabels.get(entry.section) ?? "";
		const match = matchFields(terms, fieldsOf(entry, label));
		if (match) hits.push({ entry, label, match, index });
	}
	hits.sort(
		(a, b) =>
			a.match.tier - b.match.tier ||
			b.match.score - a.match.score ||
			rank(a.entry.section) - rank(b.entry.section) ||
			a.index - b.index,
	);
	return hits.map(({ entry, label, match }) => ({
		entry,
		sectionLabel: label,
		ranges: Object.fromEntries(
			match.fields.flatMap((field) => (isShownField(field.key) ? [[field.key, field.ranges]] : [])),
		),
	}));
}
