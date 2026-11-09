import {
	SKILL_LISTING_MAX_TOKENS,
	SKILL_LISTING_MIN_TOKENS,
	type SkillCatalogEntry,
} from "@thinkrail/contracts";

const ENTRY_MARKUP_CHARS = 100;
const CHARS_PER_TOKEN = 4;

export function skillCatalogSize(entries: readonly SkillCatalogEntry[]): {
	count: number;
	tokens: number;
	budgeted: boolean;
	large: boolean;
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
	const tokens = Math.round(chars / CHARS_PER_TOKEN);
	return {
		count: loaded.length,
		tokens,
		budgeted: tokens > SKILL_LISTING_MIN_TOKENS,
		large: tokens > SKILL_LISTING_MAX_TOKENS,
	};
}
