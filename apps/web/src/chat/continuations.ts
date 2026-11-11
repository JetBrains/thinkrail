import type { ChatContinuation, ChatContinuationPhase } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useEffect } from "react";
import { toast, useAppStore } from "@/store";
import { getTransport, wsErrorCode } from "@/transport";
import { openWorkspace } from "./openWorkspace";

interface ContinuationSource {
	workspaceId: string;
	sessionId: string;
}

const UNSETTLED: ReadonlySet<ChatContinuationPhase> = new Set([
	"requested",
	"summarizing",
	"creating",
]);

/** The welcome generation each operation's status was last asked in: one read per connection. */
const askedIn = new Map<string, number>();

/**
 * Asks the host for an operation's phase once per connection. A push that lands while the read is in
 * flight is newer and wins; an operation the host no longer knows is `lost` (Retry); any other failure
 * is asked again after the next welcome.
 */
export function refreshContinuation(operationId: string, source?: ContinuationSource): void {
	const generation = useAppStore.getState().welcomeGeneration;
	if (askedIn.get(operationId) === generation) return;
	askedIn.set(operationId, generation);
	const before = useAppStore.getState().chatContinuations[operationId];
	const current = () => {
		const state = useAppStore.getState();
		return (
			state.welcomeGeneration === generation && state.chatContinuations[operationId] === before
		);
	};
	void getTransport()
		.request("chat.continuationStatus", { operationId })
		.then((status) => {
			if (current()) useAppStore.getState().applyChatContinuation(status);
		})
		.catch((err: unknown) => {
			if (wsErrorCode(err) !== "CONTINUATION_UNKNOWN" || !current()) return;
			const from = before ?? (source ? sourceRecord(operationId, source) : null);
			if (from) useAppStore.getState().applyChatContinuation({ ...from, phase: "lost" });
			else useAppStore.getState().forgetInitiatedContinuation(operationId);
		});
}

function sourceRecord(operationId: string, source: ContinuationSource): ChatContinuation {
	return {
		operationId,
		sourceWorkspaceId: source.workspaceId,
		sourceSessionId: source.sessionId,
		projectId: "",
		phase: "lost",
	};
}

/** After every welcome: each unsettled operation and each one this client started is asked again. */
export function reconcileContinuations(): void {
	const state = useAppStore.getState();
	const pending = new Set(Object.keys(state.initiatedContinuations));
	for (const continuation of Object.values(state.chatContinuations)) {
		if (UNSETTLED.has(continuation.phase)) pending.add(continuation.operationId);
	}
	for (const operationId of pending) refreshContinuation(operationId);
}

/** Asks the host to continue `workspaceId` in a new workspace of `projectId`; this client then follows it. */
export async function requestContinuation(workspaceId: string, projectId: string): Promise<string> {
	const { operationId } = await getTransport().request("chat.continue", { workspaceId, projectId });
	useAppStore.getState().noteInitiatedContinuation(operationId);
	return operationId;
}

/**
 * Only the initiating client navigates, once, when the new chat exists; a failure is told once. A follow a
 * reconnect overtook is armed again, so the connection that overtook it follows it.
 */
export function followContinuation(continuation: ChatContinuation): void {
	const store = useAppStore.getState();
	if (!store.initiatedContinuations[continuation.operationId]) return;
	if (continuation.phase === "failed" || continuation.phase === "lost") {
		store.forgetInitiatedContinuation(continuation.operationId);
		toast.error(
			continuation.reason ?? t("panels.chats.continueFailed"),
			t("panels.chats.continueFailed"),
		);
		return;
	}
	if (continuation.phase !== "started" || !continuation.workspaceId) return;
	const { operationId } = continuation;
	store.forgetInitiatedContinuation(operationId);
	void openWorkspace({
		projectId: continuation.projectId,
		workspaceId: continuation.workspaceId,
		sessionId: continuation.sessionId,
	}).then((opened) => {
		if (opened === null) useAppStore.getState().noteInitiatedContinuation(operationId);
	});
}

/** Mounted once by the shell: follows every operation this client started and re-reads them after each welcome. */
export function useContinuations(): void {
	const continuations = useAppStore((s) => s.chatContinuations);
	const initiated = useAppStore((s) => s.initiatedContinuations);
	const welcome = useAppStore((s) => s.welcomeGeneration);
	useEffect(() => {
		for (const continuation of Object.values(continuations)) followContinuation(continuation);
	}, [continuations, initiated]);
	useEffect(() => {
		if (welcome > 0) reconcileContinuations();
	}, [welcome]);
}

export function resetContinuationReadsForTests(): void {
	askedIn.clear();
}
