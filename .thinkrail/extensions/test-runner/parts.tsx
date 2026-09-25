import { cn, remixicon, startChat, ui } from "@thinkrail/ext/view";
import {
	type Counts,
	type Failure,
	fixDraft,
	locationOf,
	OUTCOME_LABEL,
	type Outcome,
	type RunResult,
} from "./model";

const {
	RiCheckboxCircleLine,
	RiCloseCircleLine,
	RiErrorWarningLine,
	RiForbidLine,
	RiTimeLine,
	RiSparkling2Line,
} = remixicon;

export const Empty = ({ title, detail }: { title: string; detail?: string }) => (
	<div
		data-testid="test-runner-empty"
		className="flex flex-1 flex-col items-center justify-center gap-4 p-24 text-center"
	>
		<p className="tr-text-ui text-text-default">{title}</p>
		{detail && <p className="tr-text-metadata break-all text-text-muted">{detail}</p>}
	</div>
);

const OUTCOME_ICON = {
	passed: RiCheckboxCircleLine,
	failed: RiCloseCircleLine,
	error: RiErrorWarningLine,
	cancelled: RiForbidLine,
	timeout: RiTimeLine,
} satisfies Record<Outcome, unknown>;

export const outcomeTone = (outcome: Outcome) =>
	outcome === "passed"
		? "text-feedback-success"
		: outcome === "cancelled"
			? "text-text-muted"
			: outcome === "timeout"
				? "text-feedback-warning"
				: "text-feedback-error";

export const OutcomeLabel = ({ outcome }: { outcome: Outcome }) => {
	const Icon = OUTCOME_ICON[outcome];
	return (
		<span
			data-testid="test-runner-outcome"
			data-outcome={outcome}
			className={cn("flex shrink-0 items-center gap-4 tr-text-ui", outcomeTone(outcome))}
		>
			<Icon className="size-14" />
			{OUTCOME_LABEL[outcome]}
		</span>
	);
};

const CHIPS = [
	{ key: "pass", label: "passed", tone: "text-feedback-success" },
	{ key: "fail", label: "failed", tone: "text-feedback-error" },
	{ key: "skip", label: "skipped", tone: "text-text-default" },
] as const satisfies readonly { key: keyof Counts; label: string; tone: string }[];

export const CountChips = ({ counts }: { counts: Counts }) => (
	<div className="flex flex-wrap items-center gap-8">
		{CHIPS.map(({ key, label, tone }) => (
			<span
				key={key}
				data-testid={`test-runner-count-${key}`}
				className={cn(
					"flex items-center gap-4 rounded-sm border border-border-muted px-8 py-2 tr-text-metadata",
					counts[key] > 0 ? tone : "text-text-subtle",
				)}
			>
				<span className="tabular-nums">{counts[key]}</span>
				<span className="text-text-muted">{label}</span>
			</span>
		))}
	</div>
);

export const FailureCard = ({
	failure,
	result,
}: {
	failure: Failure;
	result: Pick<RunResult, "command">;
}) => {
	const where = locationOf(failure);
	return (
		<li
			data-testid="test-runner-failure"
			className="flex flex-col gap-8 rounded-md border border-border-muted bg-container-elevated-bg p-12"
		>
			<div className="flex items-start gap-8">
				<RiCloseCircleLine className="mt-2 size-14 shrink-0 text-feedback-error" />
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<span
						data-testid="test-runner-failure-name"
						className="break-words tr-text-ui text-text-default"
					>
						{failure.name}
					</span>
					{where && (
						<span className="truncate tr-code-text text-text-muted" title={where}>
							{where}
						</span>
					)}
				</div>
			</div>
			<pre
				data-testid="test-runner-failure-error"
				className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-feedback-error-subtle px-8 py-4 tr-code-text text-text-default"
			>
				{failure.error}
			</pre>
			<div className="flex">
				<ui.Button
					variant="outline"
					size="sm"
					data-testid="test-runner-fix"
					onClick={() => void startChat(fixDraft(failure, result))}
				>
					<RiSparkling2Line className="size-14" /> Fix with agent
				</ui.Button>
			</div>
		</li>
	);
};

export const OutputTail = ({ output }: { output: string }) => (
	<section className="flex min-h-0 flex-col gap-4">
		<h3 className="tr-text-metadata text-text-muted">Output (last lines)</h3>
		<pre
			data-testid="test-runner-output"
			className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-muted bg-container-elevated-bg px-12 py-8 tr-code-text text-text-default"
		>
			{output || "No output."}
		</pre>
	</section>
);
