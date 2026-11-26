import { describe, expect, it } from "bun:test";
import type { SlashCommandInfo } from "@thinkrail/contracts";
import {
	argumentCompletionKeyAction,
	promptTintClass,
	replaceSlashArgument,
	slashArgument,
	slashArgumentTint,
} from "./ArgumentCompletion";

function command(name: string, argumentCompletion?: "pull-request"): SlashCommandInfo {
	return {
		name,
		source: "skill",
		sourceInfo: { path: `/skills/${name}`, source: "fixture", scope: "user", origin: "top-level" },
		...(argumentCompletion ? { argumentCompletion } : {}),
	};
}

const commands = [command("skill:reviewing-a-pr", "pull-request"), command("skill:other")];

describe("slash argument", () => {
	it("is the one-line text after a command that declares a completion", () => {
		expect(slashArgument("/skill:reviewing-a-pr ", commands)).toMatchObject({
			query: "",
			start: 22,
			command: { name: "skill:reviewing-a-pr" },
		});
		expect(slashArgument("/skill:reviewing-a-pr fix login", commands)?.query).toBe("fix login");
		expect(slashArgument("/skill:reviewing-a-pr", commands)).toBeNull();
		expect(slashArgument("/skill:other x", commands)).toBeNull();
		expect(slashArgument("/skill:reviewing-a-pr a\nb", commands)).toBeNull();
		expect(slashArgument("hi /skill:reviewing-a-pr x", commands)).toBeNull();
	});

	it("is replaced by the picked text and a space for what follows", () => {
		const value = "/skill:reviewing-a-pr sett";
		const argument = slashArgument(value, commands);
		if (!argument) throw new Error("no argument");
		expect(replaceSlashArgument(value, argument, "https://github.com/a/b/pull/1")).toBe(
			"/skill:reviewing-a-pr https://github.com/a/b/pull/1 ",
		);
	});

	it("tints the command and the argument and leaves the rest plain", () => {
		const value = "/skill:reviewing-a-pr https://x/pull/1 focus";
		expect(slashArgumentTint(value, { start: 22 }, 16)).toEqual([
			{ text: "/skill:reviewing-a-pr", tone: "command", start: 0 },
			{ text: " ", tone: "plain", start: 21 },
			{ text: "https://x/pull/1", tone: "argument", start: 22 },
			{ text: " focus", tone: "plain", start: 38 },
		]);
		expect(slashArgumentTint("plain", null, 0)).toEqual([
			{ text: "plain", tone: "plain", start: 0 },
		]);
		expect(promptTintClass("plain")).toBe("");
		expect(promptTintClass("command")).not.toBe(promptTintClass("argument"));
	});
});

describe("argument completion keys", () => {
	const open = { open: true, itemCount: 3, activeIndex: 2, tabs: true };

	it("moves, wraps, picks, tabs into filters and dismisses only while open", () => {
		expect(argumentCompletionKeyAction("ArrowDown", false, open)).toEqual({
			type: "move",
			index: 0,
		});
		expect(argumentCompletionKeyAction("ArrowUp", false, { ...open, activeIndex: 0 })).toEqual({
			type: "move",
			index: 2,
		});
		expect(argumentCompletionKeyAction("Enter", false, open)).toEqual({ type: "pick", index: 2 });
		expect(argumentCompletionKeyAction("Enter", true, open)).toEqual({ type: "none" });
		expect(argumentCompletionKeyAction("Tab", true, open)).toEqual({
			type: "tab",
			backwards: true,
		});
		expect(argumentCompletionKeyAction("Escape", false, open)).toEqual({ type: "dismiss" });
		expect(argumentCompletionKeyAction("ArrowDown", false, { ...open, open: false })).toEqual({
			type: "none",
		});
	});

	it("lets Enter through when there is nothing to pick, and Tab through without filters", () => {
		const empty = { ...open, itemCount: 0, activeIndex: 0 };
		expect(argumentCompletionKeyAction("Enter", false, empty)).toEqual({ type: "none" });
		expect(argumentCompletionKeyAction("ArrowDown", false, empty)).toEqual({ type: "none" });
		expect(argumentCompletionKeyAction("Tab", false, { ...open, tabs: false })).toEqual({
			type: "none",
		});
	});
});
