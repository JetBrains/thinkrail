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
}

interface TranscriptSyncInput {
	workspaceId: string;
	sessionId: string;
	expectedEventRevision: number;
	connectionGeneration: number;
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
): Promise<"applied" | "crossed-idle" | "crossed-streaming" | "stale"> {
	const { result } = await deps.read({
		workspaceId: input.workspaceId,
		sessionId: input.sessionId,
	});
	const state = deps.state();
	if (state.status !== "connected" || state.connectionGeneration !== input.connectionGeneration) {
		return "stale";
	}
	const applied = state.reconcileSession(
		result.summary,
		deps.hydrate(result.messages, result.summary.lastSettlement),
		input.expectedEventRevision,
		input.connectionGeneration,
	);
	if (applied) return "applied";
	return result.summary.isStreaming ? "crossed-streaming" : "crossed-idle";
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
	const waitingForIdle = useRef<string | null>(null);
	const failed = useRef<string | null>(null);
	const need = transcriptSyncNeed(runtime, connectionGeneration);
	const needKey = need ? `${connectionGeneration}:${need.compactionTurnId ?? "generation"}` : null;

	useEffect(() => {
		if (!enabled || !needKey || status !== "connected" || failed.current === needKey) return;
		if (waitingForIdle.current === needKey && runtime.isStreaming) return;
		waitingForIdle.current = null;
		let current = true;
		const expectedEventRevision = runtime.eventRevision;
		void synchronizeTranscript({
			workspaceId,
			sessionId,
			expectedEventRevision,
			connectionGeneration,
		})
			.then((outcome) => {
				if (!current || outcome === "stale") return;
				if (outcome === "applied") {
					failed.current = null;
					return;
				}
				const latest = useAppStore.getState().sessions[sessionId];
				if (!latest) return;
				if (outcome === "crossed-idle" || !latest.isStreaming) {
					setRetry((value) => value + 1);
					return;
				}
				waitingForIdle.current = needKey;
			})
			.catch((error: unknown) => {
				if (!current) return;
				const state = useAppStore.getState();
				if (state.status === "connected" && state.connectionGeneration === connectionGeneration) {
					toast.error(errorText(error), "Couldn't refresh this chat");
				}
				failed.current = needKey;
			});
		return () => {
			current = false;
		};
	}, [
		connectionGeneration,
		enabled,
		needKey,
		retry,
		runtime.isStreaming,
		sessionId,
		status,
		workspaceId,
	]);
}
