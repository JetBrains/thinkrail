import { describe, expect, it } from "bun:test";
import type { SlashCommandInfo } from "@thinkrail/contracts";
import {
	matchSlashCommands,
	selectedSlashCommandValue,
	slashCommandCatalogOrEmpty,
	slashCommandQuery,
	slashCompletionKeyAction,
} from "./SlashCommandCompletion";

function command(name: string): SlashCommandInfo {
	return {
		name,
		description: `${name} description`,
		source: "skill",
		sourceInfo: {
			path: `/skills/${name}/SKILL.md`,
			source: "fixture",
			scope: "project",
			origin: "top-level",
		},
	};
}

describe("slash command matching", () => {
	it("matches a leading whitespace-free query case-insensitively and caps at eight", () => {
		const commands = Array.from({ length: 10 }, (_, index) => command(`Skill-${index}`));
		expect(matchSlashCommands("/skill-", commands).map((item) => item.name)).toEqual(
			commands.slice(0, 8).map((item) => item.name),
		);
		expect(slashCommandQuery("hello /skill")).toBeNull();
		expect(matchSlashCommands("/skill arg", commands)).toEqual([]);
	});

	it("uses one insertion format for every caller", () => {
		expect(selectedSlashCommandValue(command("skill:review"))).toBe("/skill:review ");
	});

	it("degrades an empty or failed optional catalog to no matches", async () => {
		expect(await slashCommandCatalogOrEmpty(async () => [])).toEqual([]);
		expect(
			await slashCommandCatalogOrEmpty(async () => {
				throw new Error("host unavailable");
			}),
		).toEqual([]);
	});
});

describe("slash completion keyboard reducer", () => {
	it("wraps arrow navigation", () => {
		expect(slashCompletionKeyAction("ArrowDown", true, 2, 3)).toEqual({
			type: "move",
			index: 0,
		});
		expect(slashCompletionKeyAction("ArrowUp", true, 0, 3)).toEqual({
			type: "move",
			index: 2,
		});
	});

	it("selects on Enter or Tab and dismisses on Escape", () => {
		expect(slashCompletionKeyAction("Enter", true, 1, 3)).toEqual({
			type: "select",
			index: 1,
		});
		expect(slashCompletionKeyAction("Tab", true, 1, 3)).toEqual({
			type: "select",
			index: 1,
		});
		expect(slashCompletionKeyAction("Escape", true, 1, 3)).toEqual({ type: "dismiss" });
		expect(slashCompletionKeyAction("Enter", false, 1, 3)).toEqual({ type: "none" });
	});
});
