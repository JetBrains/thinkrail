import type { DelegationRunStatus, TranscriptMessage } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { useEffect, useMemo, useState } from "react";
import { isConnectedGeneration, useAppStore } from "@/store";
import { errorText, getTransport, wsErrorCode } from "@/transport";
import { ChatActionsContext } from "./ChatActions";
import { startDetailPolling } from "./detailPolling";
import { messagesToRuntime } from "./hydrate";
import { deriveInteractionStates, InteractionStatesContext } from "./interactionState";
import { deriveMessageActions } from "./messageActions";
import { deriveRows } from "./rows";
import { ChatTurnView } from "./turns";

function isLiveTranscriptStatus(status: DelegationRunStatus | undefined): boolean {
	return status === "queued" || status === "running";
}

function isPermanentTranscriptError(error: unknown): boolean {
	return wsErrorCode(error) === "SUBAGENT_TRANSCRIPT_NOT_FOUND";
}

interface TranscriptScope {
	workspaceId: string;
	parentSessionId: string;
	childSessionId: string;
}

function useSubagentTranscript({ workspaceId, parentSessionId, childSessionId }: TranscriptScope) {
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const status = useAppStore((state) => state.status);
	const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
	const [live, setLive] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (status !== "connected") return;
		const current = () => isConnectedGeneration(useAppStore.getState(), connectionGeneration);
		return startDetailPolling({
			read: () =>
				getTransport().request("subagent.getTranscript", {
					workspaceId,
					parentSessionId,
					childSessionId,
				}),
			isLive: (response) => current() && isLiveTranscriptStatus(response.status),
			isPermanentError: (error) => !current() || isPermanentTranscriptError(error),
			onResult: (response) => {
				if (!current()) return;
				setMessages(response.messages);
				setError(null);
				setLive(isLiveTranscriptStatus(response.status));
			},
			onError: (requestError) => {
				if (!current()) return;
				setError(errorText(requestError));
				if (isPermanentTranscriptError(requestError)) setLive(false);
			},
		}).dispose;
	}, [workspaceId, parentSessionId, childSessionId, status, connectionGeneration]);

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
	return { messages, live, error, rows, messageActions, interactionContext };
}

export function SubagentTranscriptPane(scope: TranscriptScope) {
	const t = useT();
	const { messages, live, error, rows, messageActions, interactionContext } =
		useSubagentTranscript(scope);
	return (
		<ChatActionsContext.Provider value={null}>
			<InteractionStatesContext.Provider value={interactionContext}>
				<div
					data-testid="subagent-transcript"
					data-live={live || undefined}
					className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto"
				>
					{error ? (
						<span role="alert" className="text-feedback-error tr-text-ui">
							{error}
						</span>
					) : messages === null ? (
						<span className="text-text-muted tr-text-metadata">{t("common.loading")}</span>
					) : rows.length === 0 ? (
						<span className="text-text-muted tr-text-metadata italic">
							{t("chat.subagentTranscript.empty")}
						</span>
					) : (
						rows.map((row) => (
							<div key={row.id}>
								<ChatTurnView
									row={row}
									agentResponded={messageActions.agentRespondedByUserId.get(row.id) ?? false}
									isFinalAnswer={messageActions.finalAnswerRowIds.has(row.id)}
								/>
							</div>
						))
					)}
				</div>
			</InteractionStatesContext.Provider>
		</ChatActionsContext.Provider>
	);
}

export function SubagentTranscriptDialog({
	onOpenChange,
	onCloseAutoFocus,
	...scope
}: TranscriptScope & {
	onOpenChange: (open: boolean) => void;
	onCloseAutoFocus?: (event: Event) => void;
}) {
	const t = useT();
	const status = useAppStore((state) => state.status);
	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent
				onCloseAutoFocus={onCloseAutoFocus}
				data-testid="subagent-transcript-dialog"
				className="h-[85vh] max-w-3xl gap-16 p-16"
			>
				<div className="flex min-w-0 items-baseline gap-8 pr-8">
					<DialogTitle className="shrink-0 tr-text-ui text-text-default">
						{t("chat.subagentTranscript.title")}
					</DialogTitle>
					<span className="min-w-0 truncate text-text-muted tr-text-metadata">
						{scope.childSessionId}
						{status !== "connected" ? ` · ${t("chat.subagentTranscript.stale")}` : ""}
					</span>
				</div>
				<SubagentTranscriptPane key={scope.childSessionId} {...scope} />
			</DialogContent>
		</Dialog>
	);
}
