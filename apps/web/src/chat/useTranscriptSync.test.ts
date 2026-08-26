import { expect, test } from "bun:test";
import type { SessionRuntime } from "../store/appStore";
import { synchronizeTranscript, transcriptSyncNeed } from "./useTranscriptSync";

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

test("synchronizeTranscript compare-and-installs one canonical snapshot", async () => {
	const summary = {
		sessionId: "session-1",
		workspaceId: "workspace-1",
		title: "Chat",
		model: null,
		thinkingLevel: "medium" as const,
		isStreaming: false,
		messageCount: 0,
		updatedAt: 1,
		live: true,
	};
	const hydrated = { turns: [], toolResults: {}, askAnswers: {}, turnIdByMessageIndex: [] };
	let installed: unknown[] | null = null;
	const outcome = await synchronizeTranscript(
		{
			workspaceId: "workspace-1",
			sessionId: "session-1",
			expectedEventRevision: 9,
			connectionGeneration: 6,
		},
		{
			read: async () => ({ result: { summary, messages: [] }, syncedTick: 0 }),
			hydrate: () => hydrated,
			state: () => ({
				status: "connected",
				connectionGeneration: 6,
				reconcileSession: (...args: unknown[]) => {
					installed = args;
					return true;
				},
			}),
		},
	);

	expect(outcome).toBe("applied");
	expect(installed).toEqual([summary, hydrated, 9, 6]);
});

test("synchronizeTranscript rejects a response from an overtaken connection generation", async () => {
	let reconciled = false;
	const outcome = await synchronizeTranscript(
		{
			workspaceId: "workspace-1",
			sessionId: "session-1",
			expectedEventRevision: 2,
			connectionGeneration: 4,
		},
		{
			read: async () => ({
				result: {
					summary: {
						sessionId: "session-1",
						workspaceId: "workspace-1",
						title: "Chat",
						model: null,
						thinkingLevel: "medium" as const,
						isStreaming: false,
						messageCount: 0,
						updatedAt: 1,
						live: true,
					},
					messages: [],
				},
				syncedTick: 0,
			}),
			hydrate: () => ({ turns: [], toolResults: {}, askAnswers: {} }),
			state: () => ({
				status: "connected",
				connectionGeneration: 5,
				reconcileSession: () => {
					reconciled = true;
					return true;
				},
			}),
		},
	);

	expect(outcome).toBe("stale");
	expect(reconciled).toBe(false);
});

test("synchronizeTranscript distinguishes an idle crossed snapshot so a stale streaming UI can retry", async () => {
	const outcome = await synchronizeTranscript(
		{
			workspaceId: "workspace-1",
			sessionId: "session-1",
			expectedEventRevision: 2,
			connectionGeneration: 4,
		},
		{
			read: async () => ({
				result: {
					summary: {
						sessionId: "session-1",
						workspaceId: "workspace-1",
						title: "Chat",
						model: null,
						thinkingLevel: "medium" as const,
						isStreaming: false,
						messageCount: 0,
						updatedAt: 1,
						live: true,
					},
					messages: [],
				},
				syncedTick: 0,
			}),
			hydrate: () => ({ turns: [], toolResults: {}, askAnswers: {} }),
			state: () => ({
				status: "connected",
				connectionGeneration: 4,
				reconcileSession: () => false,
			}),
		},
	);

	expect(outcome).toBe("crossed-idle");
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
