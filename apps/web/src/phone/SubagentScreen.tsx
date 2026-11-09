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
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const read = (): void => {
			client
				.request<{ messages: TranscriptMessage[]; status?: DelegationRunStatus }>(
					"subagent.getTranscript",
					{ workspaceId, parentSessionId, childSessionId },
				)
				.then((result) => {
					if (cancelled) return;
					setMessages(result.messages);
					setError(null);
					const growing = transcriptIsLive(result.status);
					setLive(growing);
					if (growing) timer = setTimeout(read, LIVE_POLL_MS);
				})
				.catch((reason: unknown) => {
					if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
				});
		};
		read();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
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
					{error ? (
						<Notice text={t("mobile.list.failed", { reason: error })} alert />
					) : messages === null ? (
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
