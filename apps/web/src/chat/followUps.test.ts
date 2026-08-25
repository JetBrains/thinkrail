import { describe, expect, it } from "bun:test";
import { deriveFollowUps } from "./followUps";
import type { ChatTurn } from "./types";

function assistant(text: string): ChatTurn {
	return {
		id: `a-${text.slice(0, 8)}`,
		kind: "assistant",
		streaming: false,
		message: { role: "assistant", content: [{ type: "text", text }] },
	} as unknown as ChatTurn;
}

function user(text: string): ChatTurn {
	return {
		id: `u-${text.slice(0, 8)}`,
		kind: "user",
		message: { role: "user", content: text },
	} as ChatTurn;
}

describe("deriveFollowUps", () => {
	it("returns nothing when there is no assistant turn", () => {
		expect(deriveFollowUps([])).toEqual([]);
		expect(deriveFollowUps([user("hello")])).toEqual([]);
	});

	it("returns nothing when the last assistant turn is empty", () => {
		expect(deriveFollowUps([assistant("   ")])).toEqual([]);
	});

	it("suggests option-related follow-ups when the agent presents options", () => {
		const items = deriveFollowUps([assistant("Here are two approaches; I recommend the first.")]);
		expect(items.map((i) => i.label)).toContain("Use the recommended option");
		for (const item of items) expect(item.prompt.length).toBeGreaterThan(item.label.length);
	});

	it("suggests fix follow-ups when the agent reports a failure", () => {
		const items = deriveFollowUps([assistant("The build failed with an error.")]);
		expect(items.map((i) => i.label)).toContain("Fix the issues");
	});

	it("falls back to defaults for unmatched content", () => {
		const items = deriveFollowUps([assistant("Hello there, how are you?")]);
		expect(items.map((i) => i.label)).toContain("Continue");
	});

	it("tracks the latest assistant turn (context changes)", () => {
		const first = deriveFollowUps([assistant("Here are the options.")]);
		const second = deriveFollowUps([
			assistant("Here are the options."),
			user("go"),
			assistant("The test suite failed."),
		]);
		expect(first.map((i) => i.label)).toContain("Use the recommended option");
		expect(second.map((i) => i.label)).not.toEqual(first.map((i) => i.label));
	});
});
