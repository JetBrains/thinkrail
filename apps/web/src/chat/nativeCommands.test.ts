import { describe, expect, it } from "bun:test";
import type { SlashCommandInfo } from "@thinkrail/contracts";
import {
	compactSubmissionError,
	mergeNativeChatCommands,
	NATIVE_CHAT_COMMANDS,
	parseNativeChatCommand,
	prepareNameChatCommand,
} from "./nativeCommands";

function command(name: string, source: SlashCommandInfo["source"] = "extension"): SlashCommandInfo {
	return {
		name,
		description: `${name} description`,
		source,
		sourceInfo: {
			path: `/${source}/${name}`,
			source: "fixture",
			scope: "project",
			origin: "top-level",
		},
	};
}

describe("native chat command parsing", () => {
	it("matches Pi's exact compact syntax and trims optional instructions", () => {
		expect(parseNativeChatCommand("/compact")).toEqual({ kind: "compact" });
		expect(parseNativeChatCommand("/compact keep exact filenames ")).toEqual({
			kind: "compact",
			instructions: "keep exact filenames",
		});
		expect(parseNativeChatCommand("/compact  \n preserve decisions \n")).toEqual({
			kind: "compact",
			instructions: "preserve decisions",
		});
		expect(parseNativeChatCommand("/compact ")).toEqual({ kind: "compact" });
	});

	it("parses name only when the connected host supports its mutation", () => {
		expect(parseNativeChatCommand("/name Fix auth redirect", true)).toEqual({
			kind: "name",
			title: "Fix auth redirect",
		});
		expect(parseNativeChatCommand("/name", true)).toEqual({ kind: "name", title: "" });
		expect(parseNativeChatCommand("/name ", true)).toEqual({ kind: "name", title: "" });
		expect(parseNativeChatCommand("/name Fix auth", false)).toBeNull();
	});

	it("validates name command text and attached-image loss before submission", () => {
		expect(prepareNameChatCommand("  Fix auth\r\nredirect  ", false)).toEqual({
			title: "Fix auth redirect",
		});
		expect(prepareNameChatCommand("", false)).toEqual({ reason: "Enter a chat name." });
		expect(prepareNameChatCommand("x".repeat(81), false)).toEqual({
			reason: "Keep chat names to 80 characters or fewer.",
		});
		expect(prepareNameChatCommand("Fix auth", true)).toEqual({
			reason: "Remove images to use /name",
		});
	});

	it("leaves every near-miss for the ordinary prompt path", () => {
		for (const text of [
			"/Compact",
			"/compactness",
			"/compact\tkeep files",
			"hello /compact",
			" /compact",
		]) {
			expect(parseNativeChatCommand(text)).toBeNull();
		}
	});

	it("rejects compaction before a text-only clear could discard draft or queued images", () => {
		expect(compactSubmissionError(false, false)).toBeNull();
		expect(compactSubmissionError(true, false)).toBe("Remove images to use /compact");
		expect(compactSubmissionError(false, true)).toBe(
			"Wait for queued image messages to send before using /compact",
		);
	});
});

describe("native chat command catalog", () => {
	it("orders supported built-ins first and reserves only their exact names", () => {
		const merged = mergeNativeChatCommands(
			[
				command("review"),
				command("compact"),
				command("compact", "prompt"),
				command("skill:compact", "skill"),
				command("name"),
				command("skill:name", "skill"),
				command("Compact"),
			],
			true,
		);

		expect(merged.map(({ name }) => name)).toEqual([
			"compact",
			"name",
			"review",
			"skill:compact",
			"skill:name",
			"Compact",
		]);
		expect(merged[0]).toEqual(NATIVE_CHAT_COMMANDS[0]);
		expect(merged[0]?.source).toBe("builtin");
		expect(merged[1]?.source).toBe("builtin");
		expect(mergeNativeChatCommands([command("name")], false).map(({ name }) => name)).toEqual([
			"compact",
			"name",
		]);
	});
});
