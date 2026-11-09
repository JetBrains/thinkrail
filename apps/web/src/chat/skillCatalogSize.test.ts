import { expect, test } from "bun:test";
import type { SkillCatalogEntry } from "@thinkrail/contracts";
import { skillCatalogSize } from "./skillCatalogSize";

const entry = (name: string, decision: SkillCatalogEntry["decision"]): SkillCatalogEntry =>
	({
		name,
		description: "d".repeat(296),
		sourceInfo: { path: "/s/SKILL.md" },
		gated: false,
		group: "personal",
		decision,
	}) as SkillCatalogEntry;

test("the catalog size counts only loaded skills and estimates their listing tokens", () => {
	const size = skillCatalogSize([entry("a", "load"), entry("b", "load"), entry("c", "disabled")]);
	expect(size.count).toBe(2);
	expect(size.tokens).toBe(Math.round((2 * (100 + 1 + 296 + 11)) / 4));
	expect(skillCatalogSize([])).toEqual({ count: 0, tokens: 0 });
});

test("a manual-only skill counts as on but adds nothing to the listing estimate", () => {
	const manual = { ...entry("m", "load"), manualOnly: true };
	expect(skillCatalogSize([manual])).toEqual({ count: 1, tokens: 0 });
});
