import { openSurface, remixicon, type SurfaceProps, ui } from "@thinkrail/ext/view";
import {
	EXT_NAME,
	formatDuration,
	isRecord,
	isRunResult,
	locationOf,
	type RunResult,
} from "./model";
import { CountChips, OutcomeLabel } from "./parts";

const { RiFlaskLine, RiLoader4Line, RiExternalLinkLine } = remixicon;

const SHOWN = 3;

const detailsOf = (value: unknown) =>
	isRecord(value) && "details" in value ? value.details : value;

const resultOf = (value: unknown): RunResult | undefined => {
	const details = detailsOf(value);
	return isRunResult(details) ? details : undefined;
};

const elapsedOf = (value: unknown) => {
	const details = detailsOf(value);
	return isRecord(details) && typeof details.elapsedMs === "number" ? details.elapsedMs : undefined;
};

const errorText = (value: unknown) => {
	if (!isRecord(value) || !Array.isArray(value.content)) return undefined;
	const block: unknown = value.content[0];
	return isRecord(block) && typeof block.text === "string" ? block.text : undefined;
};

const RunTestsCard = ({ toolCall }: SurfaceProps) => {
	if (!toolCall) return null;
	const filter = typeof toolCall.args.filter === "string" ? toolCall.args.filter : undefined;
	const result = toolCall.status === "running" ? undefined : resultOf(toolCall.result);
	const elapsed = elapsedOf(toolCall.result);
	const state = toolCall.status === "running" ? "running" : (result?.outcome ?? "error");
	return (
		<div
			data-testid="test-runner-tool"
			data-state={state}
			className="flex flex-col gap-8 rounded-md border border-border-muted bg-container-elevated-bg px-12 py-8"
		>
			<div className="flex min-w-0 items-center gap-8 tr-text-ui">
				{toolCall.status === "running" ? (
					<RiLoader4Line className="size-14 shrink-0 animate-spin text-primary" />
				) : (
					<RiFlaskLine className="size-14 shrink-0 text-text-muted" />
				)}
				<span className="shrink-0 text-text-muted">run_tests</span>
				<span className="min-w-0 truncate tr-code-text text-text-default">
					{filter ?? "all tests"}
				</span>
				<span className="ml-auto" />
				{toolCall.status === "running" ? (
					<span className="shrink-0 tabular-nums tr-text-metadata text-text-muted">
						{elapsed === undefined ? "starting" : formatDuration(elapsed)}
					</span>
				) : (
					result && <OutcomeLabel outcome={result.outcome} />
				)}
				<ui.IconTooltip label="Open the Tests panel">
					<ui.Button
						variant="ghost"
						size="icon"
						aria-label="Open the Tests panel"
						data-testid="test-runner-tool-open"
						onClick={() => openSurface(EXT_NAME, "runner")}
					>
						<RiExternalLinkLine className="size-14" />
					</ui.Button>
				</ui.IconTooltip>
			</div>
			{result && (
				<>
					<div className="flex flex-wrap items-center gap-8">
						<CountChips counts={result.counts} />
						<span className="tr-text-metadata text-text-muted">
							{formatDuration(result.durationMs)}
						</span>
					</div>
					{result.failures.length > 0 && (
						<ul className="flex flex-col gap-2">
							{result.failures.slice(0, SHOWN).map((failure, index) => (
								<li
									key={`${index}:${failure.name}`}
									data-testid="test-runner-tool-failure"
									className="flex min-w-0 items-baseline gap-8 tr-text-metadata"
								>
									<span className="min-w-0 truncate text-text-default" title={failure.name}>
										{failure.name}
									</span>
									<span className="ml-auto shrink-0 tr-code-text text-text-subtle">
										{locationOf(failure)}
									</span>
								</li>
							))}
							{result.failuresTotal > SHOWN && (
								<li className="tr-text-metadata text-text-muted">
									{result.failuresTotal - SHOWN} more
								</li>
							)}
						</ul>
					)}
				</>
			)}
			{!result && toolCall.status === "error" && (
				<p className="tr-text-metadata text-feedback-error">
					{errorText(toolCall.result) ?? "run_tests failed."}
				</p>
			)}
		</div>
	);
};

export default RunTestsCard;
