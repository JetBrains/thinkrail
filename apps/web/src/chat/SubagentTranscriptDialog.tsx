import type { TranscriptMessage } from "@thinkrail/contracts";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { errorText, getTransport } from "@/transport";
import { AskStatesContext, deriveAskStates } from "./askState";
import { ChatActionsContext } from "./ChatActions";
import { messagesToRuntime } from "./hydrate";
import { deriveRows } from "./rows";
import { ChatTurnView } from "./turns";

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

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setInterval> | undefined = setInterval(fetchTranscript, 2500);
		const stopPolling = () => {
			if (timer !== undefined) clearInterval(timer);
			timer = undefined;
		};
		function fetchTranscript() {
			getTransport()
				.request("subagent.getTranscript", { workspaceId, parentSessionId, childSessionId })
				.then((res) => {
					if (cancelled) return;
					setMessages(res.messages);
					setError(null);
					const stillLive = res.status === "queued" || res.status === "running";
					setLive(stillLive);
					if (!stillLive) stopPolling();
				})
				.catch((err) => {
					if (cancelled) return;
					setError(errorText(err));
					stopPolling(); // an unreadable transcript won't become readable by asking again
				});
		}
		fetchTranscript();
		return () => {
			cancelled = true;
			stopPolling();
		};
	}, [workspaceId, parentSessionId, childSessionId]);

	const runtime = useMemo(() => (messages ? messagesToRuntime(messages) : null), [messages]);
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
