import { ChevronDown, ChevronRight } from "lucide-react";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "../lib";
import { type PlanGlance, planSummary, stripStatus } from "./planView";
import { glanceIcon, TodoAddRow, TodoRows } from "./TodoList";
import type { ChatTodos } from "./useChatTodos";

// The chat's TODO plan surfaced inline (SPEC §Chat TODO plan): a strip in the chat header (progress + what's
// happening now) opens a popup over the chat with the plan — there is no dedicated Todo side tool;
// “Open as Markdown” creates a registered center document instead. The `Popover` is composed in
// `ChatView`, anchored to the **chat header** (not
// the strip), so the popup's
// left edge sits at the chat's left edge and its top hangs flush under the header (see ChatView). These
// two pieces are the trigger's contents and the popup body.

/**
 * The strip's contents (chevron + "TODO list" + progress + a live status). Wrapped by a PopoverTrigger.
 * The status reflects the **agent's state, not the checkboxes** (`stripStatus`): working → dot (+ the
 * current step's title, or an "In progress" label if none); waiting on a question → the `?` glyph +
 * "Waiting for your answer" **even when everything is done**; stopped mid-plan → pause + "Paused"; a
 * clean finish (all done, idle) → nothing extra. So the strip never reads "finished" while the agent is
 * actually blocked on the user — without opening the chat.
 */
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

/** The popup body — the add-row + the plan. Anchored (in ChatView) to the header: flush-left, under it. */
export function ChatPlanContent({ plan, glance }: { plan: ChatTodos; glance: PlanGlance }) {
	if (plan.data === null) return null;
	const empty = plan.data.todos.length === 0 && plan.data.groups.length === 0;
	return (
		<PopoverContent
			data-testid="chat-plan-popover"
			side="bottom"
			align="start"
			// Anchored to the header (in ChatView): align/side offsets are 0 so it hangs flush under the
			// header at the chat's left edge; square top so it reads as attached, not a floating card.
			sideOffset={0}
			alignOffset={0}
			// Cap at ~half the chat (the header is at the top, so half the space below it ≈ half the chat);
			// the inner list scrolls when the plan is taller.
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
