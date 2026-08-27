import { describe, expect, it } from "bun:test";
import type { SlashCommandInfo } from "@thinkrail/contracts";
import {
	compactSubmissionError,
	mergeNativeChatCommands,
	NATIVE_CHAT_COMMANDS,
	parseNativeChatCommand,
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
	it("orders the built-in first and reserves only its exact name", () => {
		const merged = mergeNativeChatCommands([
			command("review"),
			command("compact"),
			command("compact", "prompt"),
			command("skill:compact", "skill"),
			command("Compact"),
		]);

		expect(merged.map(({ name }) => name)).toEqual([
			"compact",
			"review",
			"skill:compact",
			"Compact",
		]);
		expect(merged[0]).toEqual(NATIVE_CHAT_COMMANDS[0]);
		expect(merged[0]?.source).toBe("builtin");
	});
});
