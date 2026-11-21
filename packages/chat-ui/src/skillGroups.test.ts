import { expect, test } from "bun:test";
import type { SkillCatalogEntry } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { groupSkills, isLeadingSkillGroup } from "./skillGroups";

const skill = (name: string, group: string, plugin?: string): SkillCatalogEntry => ({
	name,
	sourceInfo: {} as SkillCatalogEntry["sourceInfo"],
	gated: false,
	group,
	decision: "load",
	...(plugin ? { plugin } : {}),
});

test("skills group by tier: bundled, Pi, personal, plugins, then project, each labelled with its hint", () => {
	const groups = groupSkills(t, [
		skill("a", "project"),
		skill("b", "frontend", "frontend"),
		skill("c", "personal"),
		skill("d", "bundled"),
		skill("e", "bundled"),
		skill("f", "pi"),
	]);
	expect(groups.map((group) => group.key)).toEqual([
		"bundled",
		"pi",
		"personal",
		"frontend",
		"project",
	]);
	expect(groups[0]).toMatchObject({
		label: "ThinkRail",
		hint: "Bundled with the app.",
		isPlugin: false,
	});
	expect(groups[0]?.items.map((item) => item.name)).toEqual(["d", "e"]);
	expect(groups[3]).toMatchObject({ isPlugin: true, hint: "Claude plugin" });
	expect(
		groups.filter((group) => isLeadingSkillGroup(group.key)).map((group) => group.key),
	).toEqual(["bundled", "pi"]);
});
