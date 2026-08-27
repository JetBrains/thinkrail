import { expect, test } from "bun:test";
import type { SessionSummary } from "@thinkrail/contracts";
import type { SessionRuntime } from "../store/appStore";
import {
	synchronizeTranscript,
	transcriptSyncNeed,
	transcriptSyncRetryDelay,
} from "./useTranscriptSync";

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

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		sessionId: "session-1",
		workspaceId: "workspace-1",
		title: "Chat",
		model: null,
		thinkingLevel: "medium",
		isStreaming: false,
		messageCount: 0,
		updatedAt: 1,
		live: true,
		...overrides,
	};
}

test("transcriptSyncNeed requests an authoritative read for an older connection generation", () => {
	expect(transcriptSyncNeed(runtime(), 4)).toBeNull();
	expect(transcriptSyncNeed(runtime(), 5)).toEqual({
		connectionGeneration: 5,
		compactionTurnId: null,
		reason: "reconnect",
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
		reason: "compaction",
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
	const hostSummary = summary();
	const hydrated = { turns: [], toolResults: {}, askAnswers: {}, turnIdByMessageIndex: [] };
	let installed: unknown[] | null = null;
	const outcome = await synchronizeTranscript(
		{
			workspaceId: "workspace-1",
			sessionId: "session-1",
			expectedEventRevision: 9,
			connectionGeneration: 6,
			reason: "compaction",
		},
		{
			read: async () => ({ result: { summary: hostSummary, messages: [] }, syncedTick: 0 }),
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
	expect(installed).toEqual([hostSummary, hydrated, 9, 6]);
});

test("synchronizeTranscript defers a reconnect-only streaming snapshot without hydrating it", async () => {
	let hydrated = false;
	let reconciled = false;
	const outcome = await synchronizeTranscript(
		{
			workspaceId: "workspace-1",
			sessionId: "session-1",
			expectedEventRevision: 9,
			connectionGeneration: 6,
			reason: "reconnect",
		},
		{
			read: async () => ({
				result: { summary: summary({ isStreaming: true }), messages: [] },
				syncedTick: 0,
			}),
			hydrate: () => {
				hydrated = true;
				return { turns: [], toolResults: {}, askAnswers: {} };
			},
			state: () => ({
				status: "connected",
				connectionGeneration: 6,
				reconcileSession: () => {
					reconciled = true;
					return true;
				},
			}),
		},
	);

	expect(outcome).toBe("deferred-streaming");
	expect(hydrated).toBe(false);
	expect(reconciled).toBe(false);
});

test("synchronizeTranscript defers a streaming compaction snapshot without hydrating it", async () => {
	let hydrated = false;
	let reconciled = false;
	const outcome = await synchronizeTranscript(
		{
			workspaceId: "workspace-1",
			sessionId: "session-1",
			expectedEventRevision: 9,
			connectionGeneration: 6,
			reason: "compaction",
		},
		{
			read: async () => ({
				result: { summary: summary({ isStreaming: true }), messages: [] },
				syncedTick: 0,
			}),
			hydrate: () => {
				hydrated = true;
				return { turns: [], toolResults: {}, askAnswers: {} };
			},
			state: () => ({
				status: "connected",
				connectionGeneration: 6,
				reconcileSession: () => {
					reconciled = true;
					return true;
				},
			}),
		},
	);

	expect(outcome).toBe("deferred-streaming");
	expect(hydrated).toBe(false);
	expect(reconciled).toBe(false);
});

test("transcript read failures use a bounded backoff", () => {
	expect(transcriptSyncRetryDelay(1)).toBe(500);
	expect(transcriptSyncRetryDelay(2)).toBe(1_500);
	expect(transcriptSyncRetryDelay(3)).toBeNull();
});

test("synchronizeTranscript rejects a response from an overtaken connection generation", async () => {
	let reconciled = false;
	const outcome = await synchronizeTranscript(
		{
			workspaceId: "workspace-1",
			sessionId: "session-1",
			expectedEventRevision: 2,
			connectionGeneration: 4,
			reason: "reconnect",
		},
		{
			read: async () => ({ result: { summary: summary(), messages: [] }, syncedTick: 0 }),
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
			reason: "reconnect",
		},
		{
			read: async () => ({ result: { summary: summary(), messages: [] }, syncedTick: 0 }),
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
			runtime({ turns: [{ kind: "compaction", id: "compact-1", status: "done" }] }),
			8,
		),
	).toEqual({
		connectionGeneration: 8,
		compactionTurnId: "compact-1",
		reason: "reconnect",
	});
});
