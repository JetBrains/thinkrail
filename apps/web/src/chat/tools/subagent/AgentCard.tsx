import { Bot, ChevronDown, ChevronRight, Loader2, ScrollText } from "lucide-react";
import { useChatActions } from "../../ChatActions";
import { useFold } from "../../foldState";
import { Markdown } from "../../Markdown";
import type { ToolRenderProps } from "../../toolRegistry";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";
import { isTerminalRunStatus, readRunDetails, runCounters } from "./runDetails";

/**
 * Expanded body for the `Agent` tool (and `get_subagent_result`, whose result carries the same
 * `DelegationRunDetails`). The collapsed header is the live line (see `agentSummary`); this body adds
 * the task, the live activity, the usage meta, the final report behind a fold, and the transcript link.
 * `partialResult` is REPLACE — every snapshot is complete, nothing accumulates here. Reads are
 * defensive throughout (`readRunDetails`): a thrown foreground error carries no details at all.
 */
export function AgentCard({ toolCallId, args, result, status }: ToolRenderProps) {
	const actions = useChatActions();
	const details = readRunDetails(result);
	const role = details?.roleName ?? strArg(args, "subagent_type");
	const task = details?.task || strArg(args, "task");
	const terminal = details !== undefined && isTerminalRunStatus(details.status);
	// A background spawn's tool result is just the ack — pi drops onUpdate once the tool settles, so
	// this card can never go terminal; the `subagent-completion` turn is the terminal signal.
	const backgroundAck = args.run_in_background === true && details !== undefined && !terminal;
	const meta = details ? [details.model, ...runCounters(details, "split")].filter(Boolean) : [];
	const output = resultText(result);
	const [reportOpen, toggleReport] = useFold(`${toolCallId}:report`, false);

	return (
		<div data-testid="tool-agent" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs tr-text-metadata">
				<Bot className="size-3.5 shrink-0 text-text-muted" />
				<span className="shrink-0 text-primary">{role || "subagent"}</span>
				{details?.childSessionId ? (
					<span className="min-w-0 truncate text-text-muted" title={details.childSessionId}>
						{details.childSessionId}
					</span>
				) : null}
			</div>
			{task ? (
				<Collapsible lines={countLines(task)}>
					<div className="whitespace-pre-wrap break-words text-text-muted tr-text-metadata">
						{task}
					</div>
				</Collapsible>
			) : null}
			{status === "running" ? (
				details?.status === "queued" ? (
					<span className="text-text-muted tr-text-metadata">
						Queued — waiting for a delegation slot…
					</span>
				) : (
					<span
						data-testid="agent-activity"
						className="flex items-center gap-xs text-text-muted tr-text-metadata"
					>
						<Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
						<span className="min-w-0 truncate">{details?.activity ?? "Working…"}</span>
					</span>
				)
			) : null}
			{meta.length > 0 ? (
				<span className="text-text-muted tr-text-metadata">{meta.join(" · ")}</span>
			) : null}
			{status === "error" ? (
				<pre className="overflow-auto whitespace-pre-wrap px-sm py-xs text-feedback-error tr-code-text">
					{output}
				</pre>
			) : backgroundAck ? (
				<span className="text-text-muted tr-text-metadata italic">
					Running in the background — a completion message lands in this chat when it finishes; the
					transcript below follows it live.
				</span>
			) : status === "done" && !terminal ? (
				// get_subagent_result on a still-running child: its status snapshot, as plain text.
				<span className="whitespace-pre-wrap text-text-muted tr-text-metadata">{output}</span>
			) : status === "done" && output ? (
				<div className="flex flex-col gap-xs">
					<button
						type="button"
						data-testid="agent-report-toggle"
						aria-expanded={reportOpen}
						onClick={toggleReport}
						className="flex items-center gap-xs self-start text-primary tr-text-metadata hover:underline"
					>
						{reportOpen ? (
							<ChevronDown className="size-3 shrink-0" />
						) : (
							<ChevronRight className="size-3 shrink-0" />
						)}
						Report
					</button>
					{reportOpen ? (
						<div data-testid="agent-report">
							<Markdown text={output} />
						</div>
					) : null}
				</div>
			) : null}
			{actions && details?.childSessionId ? (
				<button
					type="button"
					data-testid="agent-open-transcript"
					onClick={() => actions.openSubagentTranscript(details.childSessionId)}
					className="flex items-center gap-xs self-start text-primary tr-text-metadata hover:underline"
				>
					<ScrollText className="size-3 shrink-0" />
					Open transcript
				</button>
			) : null}
		</div>
	);
}
