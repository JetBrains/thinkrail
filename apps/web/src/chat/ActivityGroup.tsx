import { Brain, Check, ChevronRight, Layers, Loader2, X } from "lucide-react";
import { cn } from "@/lib";
import { useFold } from "./foldState";
import type { ActivityStep } from "./rows";
import { getToolRenderer, getToolSummary, type ToolRenderProps } from "./toolRegistry";
import type { ToolStatus } from "./types";

/**
 * A contiguous run of routine steps (thinking + routine tool calls), collapsed by default behind one
 * header ("N steps · bash ×2, read ×4"). While the run is `live` (trailing + still streaming) the header
 * is the live ticker instead: a status spinner + the current step's registered summary — richer than the
 * footer loader's phase word, but a *status* line, never a second typing-dots loader. Expanded, steps are
 * slim borderless rows that individually reveal their full renderer body. A single-step run renders its
 * step row directly (no group header wrapping one line). Errored routine steps get no special treatment
 * (deliberate — agents often recover; `ErrorTurn` and primary error-auto-expand are the safety nets).
 */
export function ActivityGroup({
	id,
	steps,
	live,
	workspaceRoot,
}: {
	id: string;
	steps: ActivityStep[];
	live: boolean;
	workspaceRoot?: string | undefined;
}) {
	const [expanded, toggle] = useFold(id);
	const single = steps.length === 1 ? steps[0] : undefined;
	if (single)
		return <ActivityStepRow step={single} isCurrent={live} workspaceRoot={workspaceRoot} />;

	// While the run is live, window the steps so the current action stays visible instead of a wall of
	// completed steps: keep the last WINDOW steps as rows (the last is the emphasized current step) and
	// fold everything older into one "N completed steps" row. Expanding reveals all steps and — via the
	// shared fold cache — stays expanded across new steps until the user collapses it.
	if (live) {
		const { olderCount, visible } = windowActivity(steps, WINDOW);
		const shown = expanded ? steps : visible;
		return (
			<div
				data-testid="activity-group"
				data-expanded={expanded}
				data-live={live}
				data-steps={steps.length}
				className="text-muted text-xs"
			>
				{olderCount > 0 ? (
					<button
						type="button"
						data-testid="activity-group-toggle"
						aria-expanded={expanded}
						onClick={toggle}
						className="flex w-full cursor-pointer select-none items-center gap-xs rounded-[var(--radius-sm)] px-xs py-xs text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary"
					>
						<ChevronRight
							className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
						/>
						<Layers className="size-3 shrink-0" />
						<span className="min-w-0 truncate">
							{expanded
								? "Hide earlier steps"
								: `${olderCount} completed ${olderCount === 1 ? "step" : "steps"}`}
						</span>
					</button>
				) : null}
				<div className={olderCount > 0 ? "flex flex-col gap-px pl-md" : "flex flex-col gap-px"}>
					{shown.map((step, i) => (
						<ActivityStepRow
							key={step.id}
							step={step}
							isCurrent={i === shown.length - 1}
							workspaceRoot={workspaceRoot}
						/>
					))}
				</div>
			</div>
		);
	}

	// Finished: the normal collapsed summary header + expand-all (unchanged).
	const summary = summarizeSteps(steps);
	return (
		<div
			data-testid="activity-group"
			data-expanded={expanded}
			data-live={live}
			data-steps={steps.length}
			className="text-muted text-xs"
		>
			<button
				type="button"
				data-testid="activity-group-toggle"
				aria-expanded={expanded}
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-center gap-xs rounded-[var(--radius-sm)] px-xs py-xs text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary"
			>
				<ChevronRight
					className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
				<Layers className="size-3 shrink-0" />
				<span className="min-w-0 truncate" title={summary}>
					{summary}
				</span>
			</button>
			{expanded ? (
				<div className="flex flex-col gap-px pl-md">
					{steps.map((step) => (
						<ActivityStepRow key={step.id} step={step} workspaceRoot={workspaceRoot} />
					))}
				</div>
			) : null}
		</div>
	);
}

/** Steps kept visible while a run is live: the last `window` (the current step is the last of them),
 * with everything older folded into the "N completed steps" summary. Pure — unit-tested. */
export function windowActivity(
	steps: ActivityStep[],
	window: number,
): { olderCount: number; visible: ActivityStep[] } {
	const olderCount = Math.max(0, steps.length - window);
	return { olderCount, visible: steps.slice(olderCount) };
}

/** How many trailing steps stay visible (as rows) while a run streams; older ones collapse to a summary. */
const WINDOW = 4;

/** Collapsed-header summary: step count + per-tool-name tallies, capped with a "+k more" overflow. */
export function summarizeSteps(steps: ActivityStep[]): string {
	const counts = new Map<string, number>();
	for (const step of steps) {
		const name = step.kind === "thinking" ? "thinking" : step.toolName;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const names = [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
	const MAX_NAMES = 4;
	const shown = names.slice(0, MAX_NAMES).join(", ");
	const more = names.length - MAX_NAMES;
	const count = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
	return `${count} · ${shown}${more > 0 ? `, +${more} more` : ""}`;
}

function toolRenderProps(
	step: Extract<ActivityStep, { kind: "tool" }>,
	workspaceRoot: string | undefined,
): ToolRenderProps {
	return {
		toolCallId: step.toolCallId,
		toolName: step.toolName,
		args: step.args,
		result: step.tool?.raw,
		status: step.tool?.status ?? (step.dead ? "error" : "running"),
		workspaceRoot,
		streaming: step.streaming,
	};
}

/**
 * One slim, borderless step row: status icon + name + registered summary; clicking reveals the step's
 * full renderer body (the same registry renderer a `ToolCard` body uses), or the thinking text.
 * `isCurrent` marks the last step of a live run — a thinking step's `streaming` flag is the *owning
 * message's*, so the spinner is additionally gated on being the current step (a thinking block three
 * tool calls back in the same streaming message is finished, and must not keep spinning).
 */
function ActivityStepRow({
	step,
	isCurrent = false,
	workspaceRoot,
}: {
	step: ActivityStep;
	isCurrent?: boolean;
	workspaceRoot?: string | undefined;
}) {
	const [expanded, toggle] = useFold(step.id);
	if (step.kind === "thinking") {
		return (
			<div
				data-testid="activity-step"
				data-step="thinking"
				data-expanded={expanded}
				data-current={isCurrent}
				// Emphasize the current step with the established active-row tint (no new treatment).
				className={cn("text-muted text-xs", isCurrent && "rounded-[var(--radius-sm)] bg-hover")}
			>
				<StepHeader
					expanded={expanded}
					onToggle={toggle}
					icon={
						step.streaming && isCurrent ? (
							<Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
						) : (
							<Brain className="size-3 shrink-0" />
						)
					}
					name="thinking"
					summary={`${formatChars(step.text.length)} chars`}
				/>
				{expanded ? (
					<div className="whitespace-pre-wrap break-words px-sm pb-xs pl-lg">{step.text}</div>
				) : null}
			</div>
		);
	}

	const status: ToolStatus = step.tool?.status ?? (step.dead ? "error" : "running");
	const Renderer = getToolRenderer(step.toolName);
	const renderProps = toolRenderProps(step, workspaceRoot);
	return (
		<div
			data-testid="activity-step"
			data-step="tool"
			data-tool={step.toolName}
			data-status={status}
			data-expanded={expanded}
			data-current={isCurrent}
			// Emphasize the current step with the established active-row tint (no new treatment).
			className={cn("text-muted text-xs", isCurrent && "rounded-[var(--radius-sm)] bg-hover")}
		>
			<StepHeader
				expanded={expanded}
				onToggle={toggle}
				icon={
					status === "running" ? (
						<Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
					) : status === "error" ? (
						<X className="size-3 shrink-0 text-red" />
					) : (
						<Check className="size-3 shrink-0 text-green" />
					)
				}
				name={step.toolName}
				summary={getToolSummary(step.toolName, renderProps)}
			/>
			{expanded ? (
				<div className={cn("px-sm pb-xs pl-lg", status === "error" && "text-red")}>
					<Renderer {...renderProps} />
				</div>
			) : null}
		</div>
	);
}

function StepHeader({
	expanded,
	onToggle,
	icon,
	name,
	summary,
}: {
	expanded: boolean;
	onToggle: () => void;
	icon: React.ReactNode;
	name: string;
	summary: string;
}) {
	return (
		<button
			type="button"
			data-testid="activity-step-toggle"
			aria-expanded={expanded}
			onClick={onToggle}
			// Mobile-first hit area: ~32px touch rows, compact 22px density from `sm:` up.
			className="flex w-full cursor-pointer select-none items-center gap-xs rounded-[var(--radius-sm)] px-xs py-sm text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary sm:py-[3px]"
		>
			{icon}
			<span className="shrink-0 font-medium text-text">{name}</span>
			{summary ? (
				<span className="min-w-0 flex-1 truncate" title={summary}>
					{summary}
				</span>
			) : null}
			<ChevronRight
				className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
			/>
		</button>
	);
}

/** Compact a character count: 1234 → "1.2k", 980 → "980". */
function formatChars(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
