import { expect, test } from "bun:test";
import type { SessionRuntime } from "../store/appStore";
import { transcriptSyncNeed } from "./useTranscriptSync";

function runtime(overrides: Partial<SessionRuntime> = {}): SessionRuntime {
	return {
		turns: [],
		toolResults: {},
		askAnswers: {},
		currentAssistantId: null,
		attemptAssistantId: null,
		isStreaming: false,
		queue: { steering: [], followUp: [] },
		model: null,
		thinkingLevel: "medium",
		eventRevision: 0,
		syncedConnectionGeneration: 4,
		stats: null,
		commands: [],
		draft: "",
		pendingExtUi: null,
		extUiQueue: [],
		extUiStatus: {},
		extUiWidget: {},
		...overrides,
	};
}

test("transcriptSyncNeed requests an authoritative read for an older connection generation", () => {
	expect(transcriptSyncNeed(runtime(), 4)).toBeNull();
	expect(transcriptSyncNeed(runtime(), 5)).toEqual({
		connectionGeneration: 5,
		compactionTurnId: null,
	});
});

test("transcriptSyncNeed recognizes only successful live compactions without a durable summary", () => {
	const liveDone = {
		kind: "compaction" as const,
		id: "live-done",
		status: "done" as const,
		tokensBefore: 268_000,
	};
	expect(transcriptSyncNeed(runtime({ turns: [liveDone] }), 4)).toEqual({
		connectionGeneration: null,
		compactionTurnId: "live-done",
	});
	for (const turn of [
		{ ...liveDone, status: "running" as const },
		{ ...liveDone, status: "failed" as const },
		{ ...liveDone, status: "cancelled" as const },
		{ ...liveDone, summary: "already canonical" },
	]) {
		expect(transcriptSyncNeed(runtime({ turns: [turn] }), 4)).toBeNull();
	}
});

test("transcriptSyncNeed combines reconnect and compaction into one read", () => {
	expect(
		transcriptSyncNeed(
			runtime({
				turns: [{ kind: "compaction", id: "compact-1", status: "done" }],
			}),
			8,
		),
	).toEqual({ connectionGeneration: 8, compactionTurnId: "compact-1" });
});
