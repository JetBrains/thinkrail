import { describe, expect, test } from "bun:test";
import { deriveMessageActions } from "./messageActions";
import type { ChatRow } from "./rows";

function user(id: string): ChatRow {
	return { kind: "user", id, message: { role: "user", content: id, timestamp: 0 } };
}

function markdown(id: string): ChatRow {
	return { kind: "markdown", id, text: id };
}

describe("deriveMessageActions", () => {
	test("classifies answered prompts and concluding answers across completed rounds", () => {
		const rows: ChatRow[] = [
			user("user-1"),
			markdown("narration-1"),
			{ kind: "activity", id: "activity-1", steps: [], live: false },
			markdown("answer-1"),
			{
				kind: "divider",
				id: "divider-1",
				data: { elapsedMs: 1, toolCount: 0, specs: [], changedFiles: [] },
			},
			user("user-2"),
			markdown("answer-2"),
			user("user-3"),
		];

		const state = deriveMessageActions(rows, false);

		expect(Object.fromEntries(state.agentRespondedByUserId)).toEqual({
			"user-1": true,
			"user-2": true,
			"user-3": false,
		});
		expect([...state.finalAnswerRowIds].sort()).toEqual(["answer-1", "answer-2"]);
	});

	test("marks only the trailing unanswered prompt as responded while streaming", () => {
		const state = deriveMessageActions([user("user-1"), user("user-2")], true);

		expect(state.agentRespondedByUserId.get("user-1")).toBe(false);
		expect(state.agentRespondedByUserId.get("user-2")).toBe(true);
	});

	test("does not expose narration as final when later activity has no answer yet", () => {
		const state = deriveMessageActions(
			[
				user("user-1"),
				markdown("narration-1"),
				{ kind: "activity", id: "activity-1", steps: [], live: true },
			],
			true,
		);

		expect(state.finalAnswerRowIds.size).toBe(0);
	});
});
