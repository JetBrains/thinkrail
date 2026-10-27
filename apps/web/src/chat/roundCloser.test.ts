import { describe, expect, test } from "bun:test";
import { insertRoundCloser } from "./roundCloser";
import type { ChatTurn } from "./types";

const closer: ChatTurn = { kind: "system", id: "closer", text: "done" };

function command(
	id: string,
	status: "completed" | "stopped",
	delivery?: "wake" | "run" | "appended",
): ChatTurn {
	return {
		kind: "backgroundCommandCompletion",
		id,
		timestamp: 1,
		details: {
			id,
			sessionId: "s",
			name: "job",
			status,
			startedAt: 0,
			finishedAt: 1,
			output: { text: "", truncated: false },
			...(delivery ? { delivery } : {}),
		},
	};
}

describe("insertRoundCloser", () => {
	test("the closer goes before results that no one answers and after results the agent answered", () => {
		const ids = (turns: ChatTurn[]) => insertRoundCloser(turns, closer).map((turn) => turn.id);
		expect(ids([command("appended", "completed", "appended")])).toEqual(["closer", "appended"]);
		expect(ids([command("run", "completed", "run")])).toEqual(["run", "closer"]);
		expect(ids([command("wake", "stopped", "wake")])).toEqual(["wake", "closer"]);
		expect(ids([command("legacy-stop", "stopped")])).toEqual(["closer", "legacy-stop"]);
		expect(ids([command("legacy-done", "completed")])).toEqual(["legacy-done", "closer"]);
	});
});
