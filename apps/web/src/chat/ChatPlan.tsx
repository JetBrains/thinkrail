import { ChevronDown, ChevronRight } from "lucide-react";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "../lib";
import { type PlanGlance, planSummary } from "./planView";
import { glanceIcon, TodoAddRow, TodoRows } from "./TodoList";
import type { ChatTodos } from "./useChatTodos";

// The chat's TODO plan surfaced inline (SPEC §Chat TODO plan): a strip in the chat header (progress + what's
// happening now) opens a popup over the chat with the plan — which lives only in the chat (there is no
// right-panel Todo tab). The `Popover` is composed in `ChatView`, anchored to the **chat header** (not
// the strip), so the popup's
// left edge sits at the chat's left edge and its top hangs flush under the header (see ChatView). These
// two pieces are the trigger's contents and the popup body.

/**
 * The strip's contents (chevron + "TODO list" + progress + current item). Wrapped by a PopoverTrigger.
 * The current item follows the glance: working → dot + title; stopped → the waiting glyph + a short
 * "waiting" label before the title — so the strip says the system waits without opening the chat.
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
	const { done, total, current } = planSummary(plan.data);
	const Chevron = open ? ChevronDown : ChevronRight;
	const { Icon, label, className } = glanceIcon(glance);
	return (
		<>
			<Chevron className="size-3.5 shrink-0" />
			<span className="shrink-0 font-medium">TODO list</span>
			<span className="shrink-0">
				{done}/{total}
			</span>
			{current ? (
				<span
					data-testid="chat-plan-current"
					data-glance={glance}
					className={cn("flex min-w-0 items-center gap-xs", className)}
				>
					<Icon className="size-3 shrink-0" />
					{glance !== "working" ? <span className="shrink-0">{label} ·</span> : null}
					<span className="truncate">{current.title}</span>
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
			className="flex max-h-[calc(var(--radix-popover-content-available-height)*0.5)] w-[24rem] flex-col overflow-hidden rounded-t-none border-t-0 bg-surface-content p-0"
		>
			<div className="shrink-0 border-border2 border-b">
				<TodoAddRow onAdd={plan.add} onOpenMarkdown={plan.openMarkdown} />
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-xs">
				{empty ? (
					<p className="px-xs py-xs text-hint text-xs">
						No TODOs yet — the agent adds its plan here, or add one above.
					</p>
				) : (
					<TodoRows plan={plan.data} onRemove={plan.remove} glance={glance} />
				)}
			</div>
		</PopoverContent>
	);
}
