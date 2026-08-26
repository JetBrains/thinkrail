import type { DelegationRunDetails } from "@thinkrail/contracts";
import { Bot, Check, ChevronDown, ChevronRight, ScrollText, X } from "lucide-react";
import { useChatActions } from "../../ChatActions";
import { useFold } from "../../foldState";

import { Markdown } from "../../Markdown";
import { runCounters } from "./runDetails";

const OUTCOME_WORD: Record<DelegationRunDetails["status"], string> = {
	queued: "queued",
	running: "running",
	completed: "finished",
	error: "failed",
	aborted: "aborted",
};

/**
 * The compact card for a `subagent-completion` custom message — a detached (background) subagent run's
 * terminal report, rendered as its own transcript row (`subagentCompletion` turn). This is THE terminal
 * signal for a background run: its `Agent` tool card froze at the ack (pi drops `onUpdate` once a tool's
 * promise settles), so outcome + usage land here. One header line (role + outcome + counters + the
 * transcript link), the bounded report behind a fold — the OpenCode one-line-notice convention, plus the
 * fold. Presentational; the transcript link rides `ChatActions` (hidden standalone). The fold is keyed
 * by the row id in the shared fold cache, so it survives virtualization like every other fold.
 */
export function SubagentCompletionCard({
	id,
	details,
	text,
}: {
	id: string;
	details: DelegationRunDetails;
	text: string;
}) {
	const actions = useChatActions();
	const [reportOpen, toggleReport] = useFold(`${id}:report`, false);
	const failed = details.status === "error";
	const role = details.roleName ?? "subagent";
	const counters = runCounters(details).join(" · ");

	return (
		<div
			data-testid="subagent-completion"
			data-status={details.status}
			className="flex flex-col gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs tr-text-metadata"
		>
			<div className="flex items-center gap-xs">
				{failed ? (
					<X className="size-3 shrink-0 text-feedback-error" />
				) : (
					<Check className="size-3 shrink-0 text-feedback-success" />
				)}
				<Bot className="size-3.5 shrink-0 text-text-muted" />
				<span className="shrink-0 text-text-default">
					{role} {OUTCOME_WORD[details.status]}
				</span>
				{counters ? (
					<span className="min-w-0 truncate text-text-muted" title={counters}>
						{counters}
					</span>
				) : (
					<span className="flex-1" />
				)}
				{actions ? (
					<button
						type="button"
						data-testid="subagent-completion-transcript"
						onClick={() => actions.openSubagentTranscript(details.childSessionId)}
						title="Open transcript"
						className="ml-auto flex shrink-0 items-center gap-xs text-primary hover:underline"
					>
						<ScrollText className="size-3 shrink-0" />
						Transcript
					</button>
				) : null}
			</div>
			{text ? (
				<div className="flex flex-col gap-xs">
					<button
						type="button"
						data-testid="subagent-completion-report-toggle"
						aria-expanded={reportOpen}
						onClick={toggleReport}
						className="flex items-center gap-xs self-start text-primary hover:underline"
					>
						{reportOpen ? (
							<ChevronDown className="size-3 shrink-0" />
						) : (
							<ChevronRight className="size-3 shrink-0" />
						)}
						Report
					</button>
					{reportOpen ? (
						<div data-testid="subagent-completion-report">
							<Markdown text={text} />
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
