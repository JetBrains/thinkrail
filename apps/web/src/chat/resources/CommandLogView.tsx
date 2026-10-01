import type { BackgroundCommandOutputResult } from "@thinkrail/contracts";
import { Button } from "@/components/ui/button";

export function CommandLogView({
	result,
	error,
	stale,
	onRetry,
}: {
	result: BackgroundCommandOutputResult | null;
	error: string | null;
	stale: boolean;
	onRetry: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-8">
			{stale ? (
				<p className="text-feedback-warning tr-text-metadata">Logs are stale. Reconnecting…</p>
			) : null}
			{error ? (
				<div role="alert" className="text-feedback-error tr-text-ui">
					{error}
					<Button
						variant="ghost"
						size="sm"
						data-testid="resources-retry"
						disabled={stale}
						onClick={onRetry}
					>
						Retry
					</Button>
				</div>
			) : null}
			{result === null ? (
				!error ? (
					<p className="text-text-muted tr-text-metadata">Loading logs…</p>
				) : null
			) : !result.available ? (
				<p data-testid="command-log-unavailable" className="text-text-muted tr-text-ui">
					Logs are no longer available. Command output is retained only for recent work on this
					host.
				</p>
			) : (
				<>
					<p className="text-text-muted tr-text-metadata">
						{result.command.status}
						{result.command.exitCode !== undefined && result.command.exitCode !== null
							? ` · Exit ${result.command.exitCode}`
							: ""}
					</p>
					{result.output.truncated ? (
						<p className="text-feedback-warning tr-text-metadata">
							Output truncated — showing the retained tail.
						</p>
					) : null}
					{result.output.text.length === 0 ? (
						<p className="text-text-muted tr-text-metadata">No output yet.</p>
					) : null}
					<pre
						data-testid="command-log-output"
						className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-container-content-bg p-12 text-text-default tr-code-text"
					>
						{result.output.text}
					</pre>
				</>
			)}
		</div>
	);
}
