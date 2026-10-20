import type {
	BackgroundCommandCompletionDetails,
	DelegationRunDetails,
} from "@thinkrail/contracts";
import { useChatActions } from "./ChatActions";
import { useFold } from "./foldState";
import { Markdown } from "./Markdown";
import { ResultRow } from "./resources";
import { completionReport, reportTeaser, usageCounters } from "./tools/subagent/runDetails";

export function BackgroundCommandResult({
	id,
	details,
}: {
	id: string;
	details: BackgroundCommandCompletionDetails;
}) {
	const actions = useChatActions();
	const [expanded, toggle, toggleRef] = useFold(`${id}:result`, false);
	return (
		<div
			data-testid="background-command-completion"
			data-chat-fold-root
			data-resource-id={details.id}
			data-status={details.status}
			data-expanded={expanded}
		>
			<ResultRow
				source={{ kind: "command", details }}
				expanded={expanded}
				onToggle={toggle}
				toggleRef={toggleRef}
				onOpen={actions?.resultOpener({ kind: "command", id: details.id })}
			>
				<div className="flex flex-col gap-4">
					{details.errorMessage ? (
						<p role="alert" className="break-words text-feedback-error tr-text-ui">
							{details.errorMessage}
						</p>
					) : null}
					<div className="overflow-hidden rounded-sm border border-border-default bg-container-header-bg">
						<div className="border-border-default border-b px-8 py-4 text-text-muted tr-text-metadata">
							{details.output.truncated
								? "Output truncated — retained tail at completion."
								: "Output at completion"}
						</div>
						{details.output.text ? (
							<pre className="whitespace-pre-wrap break-words px-8 py-4 tr-code-text text-text-default">
								{details.output.text}
							</pre>
						) : (
							<p className="px-8 py-4 text-text-muted tr-text-metadata">No output.</p>
						)}
					</div>
				</div>
			</ResultRow>
		</div>
	);
}

export function SubagentResult({
	id,
	details,
	text,
}: {
	id: string;
	details: DelegationRunDetails;
	text: string;
}) {
	const actions = useChatActions();
	const [expanded, toggle, toggleRef] = useFold(`${id}:result`, false);
	const report = completionReport(text);
	return (
		<div
			data-testid="subagent-completion"
			data-chat-fold-root
			data-resource-id={details.childSessionId}
			data-status={details.status}
			data-expanded={expanded}
		>
			<ResultRow
				source={{ kind: "subagent", details }}
				expanded={expanded}
				onToggle={report ? toggle : undefined}
				toggleRef={toggleRef}
				meta={usageCounters(details).join(" · ")}
				teaser={reportTeaser(report)}
				onOpen={actions?.resultOpener({ kind: "subagent", childSessionId: details.childSessionId })}
			>
				{report ? (
					<div className="tr-text-reading text-text-default">
						<Markdown text={report} />
					</div>
				) : null}
			</ResultRow>
		</div>
	);
}
