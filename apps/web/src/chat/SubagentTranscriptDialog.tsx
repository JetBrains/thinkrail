import type { DelegationRunStatus, TranscriptMessage } from "@thinkrail/contracts";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { errorText, getTransport, wsErrorCode } from "@/transport";
import { AskStatesContext, deriveAskStates } from "./askState";
import { ChatActionsContext } from "./ChatActions";
import { messagesToRuntime } from "./hydrate";
import { deriveRows } from "./rows";
import { startSubagentTranscriptPolling } from "./subagentTranscriptPolling";
import { ChatTurnView } from "./turns";

function isLiveTranscriptStatus(status: DelegationRunStatus | undefined): boolean {
	return status === "queued" || status === "running";
}

function isPermanentTranscriptError(error: unknown): boolean {
	return wsErrorCode(error) === "SUBAGENT_TRANSCRIPT_NOT_FOUND";
}

export function SubagentTranscriptDialog({
	workspaceId,
	parentSessionId,
	childSessionId,
	onOpenChange,
}: {
	workspaceId: string;
	parentSessionId: string;
	childSessionId: string;
	onOpenChange: (open: boolean) => void;
}) {
	const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
	const [live, setLive] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(
		() =>
			startSubagentTranscriptPolling({
				read: () =>
					getTransport().request("subagent.getTranscript", {
						workspaceId,
						parentSessionId,
						childSessionId,
					}),
				isLive: (response) => isLiveTranscriptStatus(response.status),
				isPermanentError: isPermanentTranscriptError,
				onResult: (response) => {
					setMessages(response.messages);
					setError(null);
					setLive(isLiveTranscriptStatus(response.status));
				},
				onError: (requestError) => {
					setError(errorText(requestError));
					if (isPermanentTranscriptError(requestError)) setLive(false);
				},
			}),
		[workspaceId, parentSessionId, childSessionId],
	);

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
	const askContext = useMemo(
		() => ({
			states: runtime ? deriveAskStates(runtime.turns, runtime.askAnswers) : {},
			focusScope: {},
		}),
		[runtime],
	);

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="subagent-transcript-dialog"
				className="h-[85vh] max-w-3xl gap-16 p-16"
			>
				<div className="flex min-w-0 items-baseline gap-8 pr-8">
					<DialogTitle className="shrink-0 tr-text-ui text-text-default">
						Subagent transcript
					</DialogTitle>
					<span className="min-w-0 truncate text-text-muted tr-text-metadata">
						{childSessionId}
						{live ? " · live" : ""}
					</span>
				</div>
				<ChatActionsContext.Provider value={null}>
					<AskStatesContext.Provider value={askContext}>
						<div
							data-testid="subagent-transcript"
							className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto"
						>
							{error ? (
								<span className="text-feedback-error tr-text-ui">{error}</span>
							) : messages === null ? (
								<span className="text-text-muted tr-text-metadata">Loading…</span>
							) : rows.length === 0 ? (
								<span className="text-text-muted tr-text-metadata italic">
									Nothing in the transcript yet.
								</span>
							) : (
								rows.map((row) => (
									<div key={row.id}>
										<ChatTurnView row={row} />
									</div>
								))
							)}
						</div>
					</AskStatesContext.Provider>
				</ChatActionsContext.Provider>
			</DialogContent>
		</Dialog>
	);
}
