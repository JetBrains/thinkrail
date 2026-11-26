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

	it("ranks a name that starts with the query above one that only contains it, ties in catalog order", () => {
		const commands = [
			"skill:cloudflare-one-migrations",
			"skill:comprehensive-review",
			"skill:cross-review",
			"skill:release-socials",
			"skill:research",
			"skill:reflection",
			"skill:technical-premortem",
			"skill:cloudflare",
			"skill:zen-review",
			"skill:reviewing-a-pr",
			"review",
		].map(command);
		const names = (query: string) => matchSlashCommands(query, commands).map((item) => item.name);
		expect(names("/re")).toHaveLength(8);
		expect(names("/re").slice(0, 5)).toEqual(
			expect.arrayContaining(["skill:reviewing-a-pr", "review", "skill:research"]),
		);
		expect(names("/re")).not.toContain("skill:cloudflare-one-migrations");
		expect(names("/review")[0]).toBe("review");
		expect(names("/review")).toContain("skill:reviewing-a-pr");
		expect(names("/review").indexOf("skill:reviewing-a-pr")).toBeLessThan(
			names("/review").indexOf("skill:comprehensive-review"),
		);
		expect(names("/skill:rev")[0]).toBe("skill:reviewing-a-pr");
		expect(names("/rvwng")[0]).toBe("skill:reviewing-a-pr");
		expect(names("/").map((name) => name)).toEqual(commands.slice(0, 8).map((item) => item.name));
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
