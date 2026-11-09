import type { SkillCatalogEntry } from "@thinkrail/contracts";

const ENTRY_MARKUP_CHARS = 100;
const CHARS_PER_TOKEN = 4;
export const LARGE_SKILL_CATALOG_TOKENS = 10_000;

export function skillCatalogSize(entries: readonly SkillCatalogEntry[]): {
	count: number;
	tokens: number;
} {
	const loaded = entries.filter((entry) => entry.decision === "load");
	const chars = loaded
		.filter((entry) => !entry.manualOnly)
		.reduce(
			(sum, entry) =>
				sum +
				ENTRY_MARKUP_CHARS +
				entry.name.length +
				(entry.description?.length ?? 0) +
				entry.sourceInfo.path.length,
			0,
		);
	return { count: loaded.length, tokens: Math.round(chars / CHARS_PER_TOKEN) };
}
