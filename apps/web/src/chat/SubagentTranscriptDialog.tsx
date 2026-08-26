import type { TranscriptMessage } from "@thinkrail/contracts";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { errorText, getTransport } from "@/transport";
import { AskStatesContext, deriveAskStates } from "./askState";
import { ChatActionsContext } from "./ChatActions";
import { messagesToRuntime } from "./hydrate";
import { deriveRows } from "./rows";
import { ChatTurnView } from "./turns";

/**
 * The read-only transcript view for a delegated (subagent) child session — an overlay dialog over the
 * chat, opened via `ChatActions.openSubagentTranscript` from the Agent / completion cards. An
 * **integration file** (like `SkillsDialog`): it owns the `subagent.getTranscript` transport edge, keyed
 * `(workspaceId, parentSessionId = the owning chat, childSessionId)`, and renders the child's messages
 * with the exact primitives the chat itself uses (`messagesToRuntime` → `deriveRows` → `ChatTurnView`).
 *
 * Read-only by construction: the transcript renders under a `null` `ChatActions` provider, so nothing
 * inside can talk back (and a nested transcript link cannot exist); ask cards resolve via their own
 * derived `AskStates`. Liveness comes from the HOST with each response: `subagent.getTranscript`
 * carries the run's current registry `status` (absent once the host no longer knows the run —
 * restart, dispose), so the dialog polls every ~2.5s exactly while the host reports queued/running
 * and stops on anything else — a frozen background ack can never keep it polling a dead child.
 * Works during the run, after completion, and after a host restart — transcripts persist on disk,
 * only the in-memory run registry is lost.
 */
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
	// `live` marks the trailing activity run as the ticker, matching how the chat renders a streaming
	// transcript — the child IS streaming while the run is live.
	const rows = useMemo(
		() => (runtime ? deriveRows(runtime.turns, runtime.toolResults, live) : []),
		[runtime, live],
	);
	const askStates = useMemo(
		() => (runtime ? deriveAskStates(runtime.turns, runtime.askAnswers) : {}),
		[runtime],
	);

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="subagent-transcript-dialog"
				className="h-[85vh] max-w-3xl gap-md p-md"
			>
				<div className="flex min-w-0 items-baseline gap-sm pr-8">
					<DialogTitle className="shrink-0 tr-text-ui text-text-default">
						Subagent transcript
					</DialogTitle>
					<span className="min-w-0 truncate text-text-muted tr-text-metadata">
						{childSessionId}
						{live ? " · live" : ""}
					</span>
				</div>
				<ChatActionsContext.Provider value={null}>
					<AskStatesContext.Provider value={askStates}>
						<div
							data-testid="subagent-transcript"
							className="flex min-h-0 flex-1 flex-col gap-sm overflow-y-auto"
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
