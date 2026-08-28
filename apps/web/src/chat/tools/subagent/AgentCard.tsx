import {
	RiRobotLine as Bot,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiLoader4Line as Loader2,
	RiFileList3Line as ScrollText,
} from "@remixicon/react";
import { useChatActions } from "../../ChatActions";
import { useFold } from "../../foldState";
import { Markdown } from "../../Markdown";
import type { ToolRenderProps } from "../../toolRegistry";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";
import { isTerminalRunStatus, readRunDetails, runCounters } from "./runDetails";

export function AgentCard({ toolCallId, args, result, status }: ToolRenderProps) {
	const actions = useChatActions();
	const details = readRunDetails(result);
	const role = details?.roleName ?? strArg(args, "subagent_type");
	const task = details?.task || strArg(args, "task");
	const terminal = details !== undefined && isTerminalRunStatus(details.status);
	const backgroundAck = args.run_in_background === true && details !== undefined && !terminal;
	const meta = details ? [details.model, ...runCounters(details, "split")].filter(Boolean) : [];
	const output = resultText(result);
	const [reportOpen, toggleReport] = useFold(`${toolCallId}:report`, false);

	return (
		<div data-testid="tool-agent" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<Bot className="size-12 shrink-0 text-text-muted" />
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
						className="flex items-center gap-4 text-text-muted tr-text-metadata"
					>
						<Loader2 className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
						<span className="min-w-0 truncate">{details?.activity ?? "Working…"}</span>
					</span>
				)
			) : null}
			{meta.length > 0 ? (
				<span className="text-text-muted tr-text-metadata">{meta.join(" · ")}</span>
			) : null}
			{status === "error" ? (
				<pre className="overflow-auto whitespace-pre-wrap px-8 py-4 text-feedback-error tr-code-text">
					{output}
				</pre>
			) : backgroundAck ? (
				<span className="text-text-muted tr-text-metadata italic">
					Running in the background — a completion message lands in this chat when it finishes; the
					transcript below follows it live.
				</span>
			) : status === "done" && !terminal ? (
				<span className="whitespace-pre-wrap text-text-muted tr-text-metadata">{output}</span>
			) : status === "done" && output ? (
				<div className="flex flex-col gap-4">
					<button
						type="button"
						data-testid="agent-report-toggle"
						aria-expanded={reportOpen}
						onClick={toggleReport}
						className="flex items-center gap-4 self-start text-primary tr-text-metadata hover:underline"
					>
						{reportOpen ? (
							<ChevronDown className="size-16 shrink-0" />
						) : (
							<ChevronRight className="size-16 shrink-0" />
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
					className="flex items-center gap-4 self-start text-primary tr-text-metadata hover:underline"
				>
					<ScrollText className="size-12 shrink-0" />
					Open transcript
				</button>
			) : null}
		</div>
	);
}
