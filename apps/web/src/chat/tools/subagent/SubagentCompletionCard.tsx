import {
	RiRobotLine as Bot,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileList3Line as ScrollText,
	RiAlertLine as TriangleAlert,
	RiCloseLine as X,
} from "@remixicon/react";
import type { DelegationRunDetails } from "@thinkrail/contracts";
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
	const role = details.roleName ?? "subagent";
	const counters = runCounters(details).join(" · ");

	return (
		<div
			data-testid="subagent-completion"
			data-status={details.status}
			className="flex flex-col gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-4 tr-text-metadata"
		>
			<div className="flex items-center gap-4">
				{details.status === "error" ? (
					<X className="size-12 shrink-0 text-feedback-error" />
				) : details.status === "completed" ? (
					<Check className="size-12 shrink-0 text-feedback-success" />
				) : (
					<TriangleAlert className="size-12 shrink-0 text-feedback-warning" />
				)}
				<Bot className="size-12 shrink-0 text-text-muted" />
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
						className="ml-auto flex shrink-0 items-center gap-4 text-primary hover:underline"
					>
						<ScrollText className="size-12 shrink-0" />
						Transcript
					</button>
				) : null}
			</div>
			{text ? (
				<div className="flex flex-col gap-4">
					<button
						type="button"
						data-testid="subagent-completion-report-toggle"
						aria-expanded={reportOpen}
						onClick={toggleReport}
						className="flex items-center gap-4 self-start text-primary hover:underline"
					>
						{reportOpen ? (
							<ChevronDown className="size-16 shrink-0" />
						) : (
							<ChevronRight className="size-16 shrink-0" />
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
