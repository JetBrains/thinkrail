import {
	RiBrainLine as Brain,
	RiCheckLine as Check,
	RiArrowRightSLine as ChevronRight,
	RiStackLine as Layers,
	RiLoader4Line as Loader2,
	RiCloseLine as X,
} from "@remixicon/react";
import { cn } from "@/lib";
import { useFold } from "./foldState";
import type { ActivityStep, RoutineToolStep, ThinkingStep } from "./rows";
import { getToolRenderer, getToolSummary, type ToolRenderProps } from "./toolRegistry";
import type { ToolStatus } from "./types";

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
	const flatSteps = flattenActivitySteps(steps);
	const single = flatSteps.length === 1 ? steps[0] : undefined;
	if (single)
		return single.kind === "thinking" ? (
			<ThinkingGroup
				id={single.id}
				thought={single}
				tools={single.tools}
				live={live}
				workspaceRoot={workspaceRoot}
			/>
		) : (
			<RoutineToolRow step={single} workspaceRoot={workspaceRoot} />
		);

	const summary = live ? liveActivityTicker(steps, workspaceRoot) : summarizeSteps(steps);
	return (
		<GroupDisclosure
			id={id}
			testId="activity-group"
			live={live}
			stepCount={flatSteps.length}
			icon={<Layers className="size-12 shrink-0" />}
			summary={summary}
		>
			{steps.map((step) =>
				step.kind === "thinking" ? (
					<ThinkingGroup
						key={step.id}
						id={step.id}
						thought={step}
						tools={step.tools}
						live={false}
						workspaceRoot={workspaceRoot}
					/>
				) : (
					<RoutineToolRow key={step.id} step={step} workspaceRoot={workspaceRoot} />
				),
			)}
		</GroupDisclosure>
	);
}

export function ThinkingGroup({
	id,
	thought,
	tools,
	live,
	workspaceRoot,
}: {
	id: string;
	thought: ThinkingStep;
	tools: RoutineToolStep[];
	live: boolean;
	workspaceRoot?: string | undefined;
}) {
	const summary =
		tools.length > 0
			? live
				? liveActivityTicker(tools, workspaceRoot)
				: summarizeSteps(tools)
			: `${formatChars(thought.text.length)} chars`;
	return (
		<GroupDisclosure
			id={id}
			testId="thinking-group"
			live={live}
			stepCount={tools.length}
			icon={<Brain className="size-12 shrink-0" />}
			label="Thinking"
			summary={summary}
		>
			<div
				data-testid="thinking-group-text"
				className="whitespace-pre-wrap break-words px-8 py-4 pl-16"
			>
				{thought.text}
			</div>
			{tools.map((step) => (
				<RoutineToolRow key={step.id} step={step} workspaceRoot={workspaceRoot} />
			))}
		</GroupDisclosure>
	);
}

function GroupDisclosure({
	id,
	testId,
	live,
	stepCount,
	icon,
	label,
	summary,
	children,
}: {
	id: string;
	testId: "activity-group" | "thinking-group";
	live: boolean;
	stepCount: number;
	icon: React.ReactNode;
	label?: string;
	summary: string;
	children: React.ReactNode;
}) {
	const [expanded, toggle] = useFold(id);
	return (
		<div
			data-testid={testId}
			data-expanded={expanded}
			data-live={live}
			data-steps={stepCount}
			className="text-text-muted tr-text-metadata"
		>
			<button
				type="button"
				data-testid={`${testId}-toggle`}
				aria-expanded={expanded}
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-center gap-4 rounded-[var(--radius-sm)] px-4 py-4 text-left outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
			>
				<ChevronRight
					className={`size-16 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
				{live ? (
					<Loader2 className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
				) : (
					icon
				)}
				{label ? <span className="shrink-0 text-text-default">{label}</span> : null}
				<span className="min-w-0 truncate" title={summary}>
					{summary}
				</span>
			</button>
			{expanded ? <div className="flex flex-col gap-px pl-12">{children}</div> : null}
		</div>
	);
}

function flattenActivitySteps(steps: ActivityStep[]): ActivityStep[] {
	return steps.flatMap((step) => (step.kind === "thinking" ? [step, ...step.tools] : [step]));
}

export function summarizeSteps(steps: ActivityStep[]): string {
	const flatSteps = flattenActivitySteps(steps);
	const counts = new Map<string, number>();
	for (const step of flatSteps) {
		const name = step.kind === "thinking" ? "thinking" : step.toolName;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const names = [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
	const MAX_NAMES = 4;
	const shown = names.slice(0, MAX_NAMES).join(", ");
	const more = names.length - MAX_NAMES;
	const count = `${flatSteps.length} ${flatSteps.length === 1 ? "step" : "steps"}`;
	return `${count} · ${shown}${more > 0 ? `, +${more} more` : ""}`;
}

function liveActivityTicker(steps: ActivityStep[], workspaceRoot: string | undefined): string {
	const flatSteps = flattenActivitySteps(steps);
	const current = flatSteps[flatSteps.length - 1];
	if (!current) return "Working…";
	if (current.kind === "thinking") return "Thinking…";
	const summary = getToolSummary(current.toolName, toolRenderProps(current, workspaceRoot));
	return summary ? `${current.toolName} · ${summary}` : `${current.toolName}…`;
}

function toolRenderProps(
	step: RoutineToolStep,
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

function RoutineToolRow({
	step,
	workspaceRoot,
}: {
	step: RoutineToolStep;
	workspaceRoot?: string | undefined;
}) {
	const [expanded, toggle] = useFold(step.id);
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
			className="text-text-muted tr-text-metadata"
		>
			<StepHeader
				expanded={expanded}
				onToggle={toggle}
				icon={
					status === "running" ? (
						<Loader2 className="size-12 shrink-0 animate-spin motion-reduce:animate-none" />
					) : status === "error" ? (
						<X className="size-12 shrink-0 text-feedback-error" />
					) : (
						<Check className="size-12 shrink-0 text-feedback-success" />
					)
				}
				name={step.toolName}
				summary={getToolSummary(step.toolName, renderProps)}
			/>
			{expanded ? (
				<div className={cn("px-8 pb-4 pl-16", status === "error" && "text-feedback-error")}>
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
			className="flex w-full cursor-pointer select-none items-center gap-4 rounded-[var(--radius-sm)] px-4 py-8 text-left outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary sm:py-2"
		>
			{icon}
			<span className="shrink-0 text-text-default">{name}</span>
			{summary ? (
				<span className="min-w-0 flex-1 truncate" title={summary}>
					{summary}
				</span>
			) : null}
			<ChevronRight
				className={`size-16 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
			/>
		</button>
	);
}

function formatChars(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
