import { ChevronDown, ChevronRight } from "lucide-react";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "../lib";
import { type PlanGlance, planSummary, stripStatus } from "./planView";
import { glanceIcon, TodoAddRow, TodoRows } from "./TodoList";
import type { ChatTodos } from "./useChatTodos";

export function ChatPlanStripContent({
	plan,
	open,
	glance,
}: {
	plan: ChatTodos;
	open: boolean;
	glance: PlanGlance;
}) {
	if (plan.data === null) return null;
	const summary = planSummary(plan.data);
	const { done, total } = summary;
	const status = stripStatus(glance, summary);
	const Chevron = open ? ChevronDown : ChevronRight;
	const { Icon, label, className } = glanceIcon(glance);
	return (
		<>
			<Chevron className="size-3.5 shrink-0" />
			<span className="tr-text-emphasis shrink-0">TODO list</span>
			<span className="shrink-0">
				{done}/{total}
			</span>
			{status.show ? (
				<span
					data-testid="chat-plan-status"
					data-glance={glance}
					className={cn("flex min-w-0 items-center gap-xs", className)}
				>
					<Icon className="size-3 shrink-0" />
					{status.showLabel ? (
						<span className="shrink-0">
							{label}
							{status.title ? " ·" : ""}
						</span>
					) : null}
					{status.title ? <span className="truncate">{status.title}</span> : null}
				</span>
			) : null}
		</>
	);
}

export function ChatPlanContent({ plan, glance }: { plan: ChatTodos; glance: PlanGlance }) {
	if (plan.data === null) return null;
	const empty = plan.data.todos.length === 0 && plan.data.groups.length === 0;
	return (
		<PopoverContent
			data-testid="chat-plan-popover"
			side="bottom"
			align="start"
			sideOffset={0}
			alignOffset={0}
			className="flex max-h-[calc(var(--radix-popover-content-available-height)*0.5)] w-[24rem] flex-col overflow-hidden rounded-t-none border-t-0 bg-container-content-bg p-0"
		>
			<div className="shrink-0 border-border-muted border-b">
				<TodoAddRow onAdd={plan.add} onOpenPlan={plan.openPlan} />
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-xs">
				{empty ? (
					<p className="px-xs py-xs text-text-muted tr-text-metadata">
						No TODOs yet — the agent adds its plan here, or add one above.
					</p>
				) : (
					<TodoRows
						plan={plan.data}
						onRemove={plan.remove}
						glance={glance}
						onOpenChanges={plan.openChanges}
					/>
				)}
			</div>
		</PopoverContent>
	);
}
