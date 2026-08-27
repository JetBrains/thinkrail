import { useEffect, useRef, useState } from "react";
import { type SessionRuntime, toast, useAppStore } from "../store";
import {
	type ConnectionStatus,
	errorText,
	getSessionMessagesWithSkillBaseline,
} from "../transport";
import { messagesToRuntime } from "./hydrate";

export interface TranscriptSyncNeed {
	connectionGeneration: number | null;
	compactionTurnId: string | null;
	reason: "compaction" | "reconnect";
}

interface TranscriptSyncInput {
	workspaceId: string;
	sessionId: string;
	expectedEventRevision: number;
	connectionGeneration: number;
	reason: "compaction" | "reconnect";
}

interface TranscriptSyncDependencies {
	read: typeof getSessionMessagesWithSkillBaseline;
	hydrate: typeof messagesToRuntime;
	state: () => Pick<
		ReturnType<typeof useAppStore.getState>,
		"status" | "connectionGeneration" | "reconcileSession"
	>;
}

const transcriptSyncDependencies: TranscriptSyncDependencies = {
	read: getSessionMessagesWithSkillBaseline,
	hydrate: messagesToRuntime,
	state: useAppStore.getState,
};

export async function synchronizeTranscript(
	input: TranscriptSyncInput,
	deps: TranscriptSyncDependencies = transcriptSyncDependencies,
): Promise<"applied" | "crossed-idle" | "crossed-streaming" | "deferred-streaming" | "stale"> {
	const { result } = await deps.read({
		workspaceId: input.workspaceId,
		sessionId: input.sessionId,
	});
	const state = deps.state();
	if (state.status !== "connected" || state.connectionGeneration !== input.connectionGeneration) {
		return "stale";
	}
	if (result.summary.isStreaming) return "deferred-streaming";
	const applied = state.reconcileSession(
		result.summary,
		deps.hydrate(result.messages, result.summary.lastSettlement),
		input.expectedEventRevision,
		input.connectionGeneration,
	);
	if (applied) return "applied";
	return result.summary.isStreaming ? "crossed-streaming" : "crossed-idle";
}

const TRANSCRIPT_SYNC_RETRY_DELAYS = [500, 1_500] as const;

export function transcriptSyncRetryDelay(failureCount: number): number | null {
	return TRANSCRIPT_SYNC_RETRY_DELAYS[failureCount - 1] ?? null;
}

export function transcriptSyncNeed(
	runtime: SessionRuntime,
	connectionGeneration: number,
): TranscriptSyncNeed | null {
	const compaction = runtime.turns.findLast(
		(turn) => turn.kind === "compaction" && turn.status === "done" && turn.summary === undefined,
	);
	const generation =
		runtime.syncedConnectionGeneration < connectionGeneration ? connectionGeneration : null;
	if (generation === null && compaction === undefined) return null;
	return {
		connectionGeneration: generation,
		compactionTurnId: compaction?.id ?? null,
		reason: generation !== null ? "reconnect" : "compaction",
	};
}

export function useTranscriptSync({
	workspaceId,
	sessionId,
	runtime,
	status,
	connectionGeneration,
	enabled = true,
}: {
	workspaceId: string;
	sessionId: string;
	runtime: SessionRuntime;
	status: ConnectionStatus;
	connectionGeneration: number;
	enabled?: boolean;
}): void {
	const [retry, setRetry] = useState(0);
	const waitingForIdle = useRef<{ key: string; eventRevision: number } | null>(null);
	const failure = useRef<{ key: string; count: number } | null>(null);
	const need = transcriptSyncNeed(runtime, connectionGeneration);
	const needKey = need ? `${connectionGeneration}:${need.compactionTurnId ?? "generation"}` : null;
	const failureCount = failure.current?.key === needKey ? failure.current.count : 0;
	const exhausted = failureCount > 0 && transcriptSyncRetryDelay(failureCount) === null;

	useEffect(() => {
		if (!enabled || !needKey || status !== "connected" || exhausted) return;
		const waiting = waitingForIdle.current;
		if (waiting?.key === needKey) {
			if (waiting.eventRevision === runtime.eventRevision || runtime.isStreaming) return;
		} else if (waiting) {
			waitingForIdle.current = null;
		}
		waitingForIdle.current = null;
		let current = true;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const expectedEventRevision = runtime.eventRevision;
		void synchronizeTranscript({
			workspaceId,
			sessionId,
			expectedEventRevision,
			connectionGeneration,
			reason: need?.reason ?? "reconnect",
		})
			.then((outcome) => {
				if (!current || outcome === "stale") return;
				failure.current = null;
				if (outcome === "applied") return;
				const latest = useAppStore.getState().sessions[sessionId];
				if (!latest) return;
				if (outcome === "deferred-streaming") {
					waitingForIdle.current = { key: needKey, eventRevision: latest.eventRevision };
					return;
				}
				if (outcome === "crossed-idle" || !latest.isStreaming) {
					setRetry((value) => value + 1);
					return;
				}
				waitingForIdle.current = { key: needKey, eventRevision: latest.eventRevision };
			})
			.catch((error: unknown) => {
				if (!current) return;
				const previous = failure.current?.key === needKey ? failure.current.count : 0;
				const count = previous + 1;
				failure.current = { key: needKey, count };
				const delay = transcriptSyncRetryDelay(count);
				if (delay !== null) {
					retryTimer = setTimeout(() => {
						if (current) setRetry((value) => value + 1);
					}, delay);
					return;
				}
				const state = useAppStore.getState();
				if (state.status === "connected" && state.connectionGeneration === connectionGeneration) {
					toast.error(errorText(error), "Couldn't refresh this chat");
				}
			});
		return () => {
			current = false;
			if (retryTimer !== undefined) clearTimeout(retryTimer);
		};
	}, [
		connectionGeneration,
		enabled,
		needKey,
		exhausted,
		retry,
		runtime.eventRevision,
		runtime.isStreaming,
		sessionId,
		status,
		workspaceId,
	]);
}
