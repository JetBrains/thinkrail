import type { BackgroundCommandOutputResult } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

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
	const t = useT();
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-8">
			{stale ? (
				<p className="text-feedback-warning tr-text-metadata">{t("resources.log.stale")}</p>
			) : null}
			{error ? (
				<div role="alert" className="text-feedback-error tr-text-ui">
					{error}
					<Button
						variant="ghost"
						size="m"
						data-testid="resources-retry"
						disabled={stale}
						onClick={onRetry}
					>
						{t("common.retry")}
					</Button>
				</div>
			) : null}
			{result === null ? (
				!error ? (
					<p className="text-text-muted tr-text-metadata">{t("resources.log.loading")}</p>
				) : null
			) : !result.available ? (
				<p data-testid="command-log-unavailable" className="text-text-muted tr-text-ui">
					{t("resources.log.unavailable")}
				</p>
			) : (
				<>
					{result.output.truncated ? (
						<p className="text-feedback-warning tr-text-metadata">{t("resources.log.truncated")}</p>
					) : null}
					{result.output.text.length === 0 ? (
						<p className="text-text-muted tr-text-metadata">{t("resources.log.empty")}</p>
					) : null}
					<pre
						data-testid="command-log-output"
						className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-container-content-bg p-12 text-text-default tr-code-text"
					>
						{result.output.text}
					</pre>
				</>
			)}
		</div>
	);
}
