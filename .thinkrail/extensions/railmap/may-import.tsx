import { cn, remixicon, type SurfaceProps } from "@thinkrail/ext/view";
import { isRecord, type MayImportResult, type Verdict } from "./model";

const { RiCheckLine, RiCloseLine, RiQuestionLine, RiLoader4Line } = remixicon;

const VERDICTS: readonly Verdict[] = ["allowed", "undeclared", "bypass", "unknown"];

const resultOf = (value: unknown): MayImportResult | undefined => {
	const details = isRecord(value) && isRecord(value.details) ? value.details : value;
	if (!isRecord(details) || typeof details.reason !== "string") return undefined;
	const verdict = VERDICTS.find((each) => each === details.verdict);
	if (!verdict) return undefined;
	return {
		verdict,
		reason: details.reason,
		...(typeof details.from === "string" ? { from: details.from } : {}),
		...(typeof details.to === "string" ? { to: details.to } : {}),
		...(typeof details.barrel === "string" ? { barrel: details.barrel } : {}),
	};
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

const MayImportCard = ({ toolCall }: SurfaceProps) => {
	if (!toolCall) return null;
	const result = resultOf(toolCall.result);
	const verdict = toolCall.status === "running" ? undefined : result?.verdict;
	const Icon =
		verdict === undefined
			? RiLoader4Line
			: verdict === "allowed"
				? RiCheckLine
				: verdict === "unknown"
					? RiQuestionLine
					: RiCloseLine;
	return (
		<div
			data-testid="railmap-may-import"
			data-verdict={verdict ?? "running"}
			className="flex flex-col gap-4 rounded-md border border-border-muted bg-container-elevated-bg px-12 py-8"
		>
			<div className="flex min-w-0 items-center gap-8 tr-text-ui">
				<Icon
					className={cn(
						"size-14 shrink-0",
						verdict === "allowed" && "text-feedback-success",
						(verdict === "undeclared" || verdict === "bypass") && "text-feedback-error",
						(verdict === undefined || verdict === "unknown") && "text-text-muted",
					)}
				/>
				<span className="shrink-0 text-text-muted">may_import</span>
				<span className="min-w-0 truncate tr-code-text text-text-default">
					{result?.from ?? text(toolCall.args.from)} → {result?.to ?? text(toolCall.args.to)}
				</span>
				{verdict && (
					<span
						data-testid="railmap-may-import-verdict"
						className={cn(
							"ml-auto shrink-0 rounded-sm px-4 tr-text-metadata",
							verdict === "allowed"
								? "bg-feedback-success-subtle text-feedback-success"
								: verdict === "unknown"
									? "bg-control-bg text-text-muted"
									: "bg-feedback-error-subtle text-feedback-error",
						)}
					>
						{verdict}
					</span>
				)}
			</div>
			{result && <p className="tr-text-metadata text-text-muted">{result.reason}</p>}
		</div>
	);
};

export default MayImportCard;
