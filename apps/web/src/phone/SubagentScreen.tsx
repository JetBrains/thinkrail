import { messagesToRuntime } from "@thinkrail/chat-ui/hydrate";
import {
	deriveInteractionStates,
	InteractionStatesContext,
} from "@thinkrail/chat-ui/interactionState";
import { deriveMessageActions } from "@thinkrail/chat-ui/messageActions";
import { deriveRows } from "@thinkrail/chat-ui/rows";
import { isTerminalRunStatus } from "@thinkrail/chat-ui/tools/subagent/runDetails";
import { ChatTurnView } from "@thinkrail/chat-ui/turns";
import type { DelegationRunStatus, TranscriptMessage } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import { useEffect, useMemo, useState } from "react";
import { reasonOf } from "./async";
import { Loader, Notice, Screen } from "./layout";

const LIVE_POLL_MS = 1_500;

export interface OpenSubagent {
	workspaceId: string;
	parentSessionId: string;
	childSessionId: string;
}

/** A transcript is still growing until its run reaches a terminal status; one with no status is a finished read. */
export const transcriptIsLive = (status: DelegationRunStatus | undefined): boolean =>
	status !== undefined && !isTerminalRunStatus(status);

type TranscriptRead = { messages: TranscriptMessage[]; status?: DelegationRunStatus };

/**
 * Reads a subagent transcript and keeps re-reading it while its run can grow — after a failed read too, while
 * the last good read said it was live, so a passing drop does not freeze it. Returns the stop for unmount.
 */
export function pollTranscript(
	read: () => Promise<TranscriptRead>,
	on: { result: (result: TranscriptRead, live: boolean) => void; error: (reason: string) => void },
	schedule: (next: () => void) => () => void = (next) => {
		const timer = setTimeout(next, LIVE_POLL_MS);
		return () => clearTimeout(timer);
	},
): () => void {
	let stopped = false;
	let live = false;
	let cancel = (): void => {};
	const tick = (): void => {
		read().then(
			(result) => {
				if (stopped) return;
				live = transcriptIsLive(result.status);
				on.result(result, live);
				if (live) cancel = schedule(tick);
			},
			(error: unknown) => {
				if (stopped) return;
				on.error(reasonOf(error));
				if (live) cancel = schedule(tick);
			},
		);
	};
	tick();
	return () => {
		stopped = true;
		cancel();
	};
}

/** The IDE's subagent transcript dialog as a phone screen: read-only, re-read while the run is live. */
export function SubagentScreen({
	subagent,
	client,
	workspaceRoot,
	backLabel,
	onBack,
}: {
	subagent: OpenSubagent;
	client: DeviceWireClient | null;
	workspaceRoot: string | undefined;
	backLabel: string;
	onBack: () => void;
}) {
	const t = useT();
	const { workspaceId, parentSessionId, childSessionId } = subagent;
	const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
	const [live, setLive] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!client) return;
		return pollTranscript(
			() =>
				client.request<TranscriptRead>("subagent.getTranscript", {
					workspaceId,
					parentSessionId,
					childSessionId,
				}),
			{
				result: (result, growing) => {
					setMessages(result.messages);
					setError(null);
					setLive(growing);
				},
				error: setError,
			},
		);
	}, [client, workspaceId, parentSessionId, childSessionId]);

	const runtime = useMemo(
		() =>
			messages
				? messagesToRuntime(messages, undefined, { idScope: `subagent:${childSessionId}` })
				: null,
		[messages, childSessionId],
	);
	const rows = useMemo(
		() => (runtime ? deriveRows(runtime.turns, runtime.toolResults, live) : []),
		[runtime, live],
	);
	const messageActions = useMemo(() => deriveMessageActions(rows, live), [rows, live]);
	const interactionContext = useMemo(
		() => ({
			states: runtime
				? deriveInteractionStates(runtime.turns, runtime.toolResponses, runtime.toolResults)
				: {},
			focusScope: {},
		}),
		[runtime],
	);

	return (
		<Screen title={t("chat.subagentTranscript.title")} back={{ label: backLabel, onBack }}>
			<InteractionStatesContext.Provider value={interactionContext}>
				<div
					data-testid="subagent-transcript"
					className="@container flex flex-col gap-8 px-chat-gutter py-16"
				>
					{error ? <Notice text={t("mobile.list.failed", { reason: error })} alert /> : null}
					{error && messages === null ? null : messages === null ? (
						<Loader text={t("mobile.session.loading")} />
					) : rows.length === 0 ? (
						<Notice text={t("chat.subagentTranscript.empty")} />
					) : (
						rows.map((row) => (
							<div key={row.id}>
								<ChatTurnView
									row={row}
									workspaceRoot={workspaceRoot}
									agentResponded={messageActions.agentRespondedByUserId.get(row.id) ?? false}
									isFinalAnswer={messageActions.finalAnswerRowIds.has(row.id)}
								/>
							</div>
						))
					)}
				</div>
			</InteractionStatesContext.Provider>
		</Screen>
	);
}
