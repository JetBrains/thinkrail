import { RiTerminalBoxLine } from "@remixicon/react";
import type { BackgroundCommandCompletionDetails } from "@thinkrail/contracts";

export function BackgroundCommandCompletion({
	details,
}: {
	details: BackgroundCommandCompletionDetails;
}) {
	return (
		<div
			data-testid="background-command-completion"
			data-resource-id={details.id}
			data-status={details.status}
			className="flex min-w-0 flex-col gap-8 rounded-[var(--radius-sm)] border border-border-muted p-12"
		>
			<div className="flex min-w-0 items-center gap-4 tr-text-ui">
				<RiTerminalBoxLine className="size-12 shrink-0 text-text-muted" />
				<span className="min-w-0 truncate">{details.name}</span>
				<span className="shrink-0 text-text-muted tr-text-metadata">
					{details.status}
					{details.exitCode !== undefined && details.exitCode !== null
						? ` · Exit ${details.exitCode}`
						: ""}
				</span>
			</div>
			{details.errorMessage ? (
				<p role="alert" className="break-words text-feedback-error tr-text-ui">
					{details.errorMessage}
				</p>
			) : null}
			{details.output.truncated ? (
				<p className="text-text-muted tr-text-metadata">
					Output truncated — retained tail at completion.
				</p>
			) : null}
			{details.output.text ? (
				<pre className="max-h-240 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-container-content-bg p-8 tr-code-text">
					{details.output.text}
				</pre>
			) : (
				<p className="text-text-muted tr-text-metadata">No output.</p>
			)}
		</div>
	);
}
