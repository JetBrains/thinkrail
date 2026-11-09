import type { SkillCatalogEntry } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

const TIER_META: Record<string, { label: MessageKey | null; hint: MessageKey; rank: number }> = {
	bundled: { label: null, hint: "chat.skills.tier.bundledHint", rank: 0 },
	pi: { label: null, hint: "chat.skills.tier.piHint", rank: 1 },
	personal: { label: "chat.skills.tier.personal", hint: "chat.skills.tier.personalHint", rank: 2 },
	project: { label: "chat.skills.tier.project", hint: "chat.skills.tier.projectHint", rank: 4 },
};

const TIER_BRAND: Record<string, string> = { bundled: "ThinkRail", pi: "Pi" };

/** The `@plugins` master group that gates every plugin group. */
export const ALL_PLUGINS_GROUP = "@plugins";

export interface SkillGroup {
	key: string;
	label: string;
	hint: string;
	isPlugin: boolean;
	items: SkillCatalogEntry[];
}

/** The Skills dialog's groups: bundled, Pi, personal, plugins, then project, each with its label and hint. */
export function groupSkills(t: Translator, entries: readonly SkillCatalogEntry[]): SkillGroup[] {
	const byKey = new Map<string, { isPlugin: boolean; items: SkillCatalogEntry[] }>();
	for (const entry of entries) {
		const group = byKey.get(entry.group) ?? { isPlugin: Boolean(entry.plugin), items: [] };
		group.items.push(entry);
		byKey.set(entry.group, group);
	}
	return [...byKey.entries()]
		.map(([key, group]) => {
			const meta = TIER_META[key];
			return {
				key,
				label: meta?.label ? t(meta.label) : (TIER_BRAND[key] ?? key),
				hint: group.isPlugin ? t("chat.skills.pluginHint") : meta ? t(meta.hint) : "",
				isPlugin: group.isPlugin,
				items: group.items,
				rank: group.isPlugin ? 3 : (meta?.rank ?? 5),
			};
		})
		.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
		.map(({ rank: _rank, ...group }) => group);
}

/** Bundled and Pi groups sit above the All plugins master switch; the rest below it. */
export const isLeadingSkillGroup = (key: string): boolean => key === "bundled" || key === "pi";
