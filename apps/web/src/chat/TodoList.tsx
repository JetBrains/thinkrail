import type { TodoGroupItem, TodoItem, TodoPlan, TodoStatus } from "@thinkrail/contracts";
import {
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	CircleDot,
	CircleHelp,
	CirclePause,
	FileText,
	Plus,
	Trash2,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../lib";
import { groupProgress, groupStatus, type PlanGlance } from "./planView";

// Presentational TODO rendering for the in-chat plan popup (SPEC §Chat TODO plan). Props-driven (no transport) —
// the caller supplies the plan + edit callbacks (see `useChatTodos`) and the glance state (see
// `planView.ts`). The plan renders **group-first** — group = task: the loose lane (the user's own items)
// first, then the groups in plan order, each under a header row (derived status + title + done/total
// badge); a fully-done group folds into one expandable row. The in_progress step's icon follows the
// glance: working → dot, stopped on a question → `?`, stopped otherwise → pause — so the list never
// claims "in work" while the system waits. Status is read-only (agent-owned); the user's edit surface is
// add + remove.

const STATUS_LABEL: Record<TodoStatus, string> = {
	in_progress: "In progress",
	pending: "To do",
	done: "Done",
};

/** The in_progress glyph + hover label for a glance state (shared by the rows and the header strip). */
export function glanceIcon(glance: PlanGlance): {
	Icon: typeof CircleDot;
	label: string;
	className: string;
} {
	if (glance === "waiting_question")
		return { Icon: CircleHelp, label: "Waiting for your answer", className: "text-primary" };
	if (glance === "waiting")
		return { Icon: CirclePause, label: "Paused — waiting for you", className: "text-hint" };
	return { Icon: CircleDot, label: STATUS_LABEL.in_progress, className: "text-primary" };
}

/** The hover label for an item's status glyph (glance-aware for the in_progress step). */
function statusLabel(status: TodoStatus, glance: PlanGlance): string {
	return status === "in_progress" ? glanceIcon(glance).label : STATUS_LABEL[status];
}

function StatusIcon({ status, glance }: { status: TodoStatus; glance: PlanGlance }) {
	if (status === "done") return <Check className="size-4 shrink-0 text-primary" />;
	if (status === "in_progress") {
		const { Icon, className } = glanceIcon(glance);
		return <Icon data-glance={glance} className={cn("size-4 shrink-0", className)} />;
	}
	return <Circle className="size-4 shrink-0 text-hint" />;
}

/** The add-a-TODO input row, with an "open as markdown" action on the right. */
export function TodoAddRow({
	onAdd,
	onOpenMarkdown,
}: {
	onAdd: (title: string) => Promise<void>;
	onOpenMarkdown?: () => void;
}) {
	const [draft, setDraft] = useState("");
	const submit = async () => {
		const title = draft.trim();
		if (!title) return;
		try {
			await onAdd(title);
			setDraft(""); // clear only on success, so a failed add keeps the user's text to retry
		} catch {
			// keep the draft; useChatTodos surfaces the failure
		}
	};
	return (
		<div className="flex items-center gap-sm px-sm py-xs">
			<Plus className="size-3.5 shrink-0 text-hint" />
			<input
				data-testid="todo-add-input"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") void submit();
				}}
				placeholder="Add a TODO for the agent…"
				className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-hint"
			/>
			{onOpenMarkdown ? (
				<button
					type="button"
					data-testid="todo-open-markdown"
					onClick={onOpenMarkdown}
					aria-label="Open as markdown"
					title="Open the plan as a markdown tab"
					className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-hint hover:bg-hover hover:text-text focus-visible:opacity-100"
				>
					<FileText className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}

/**
 * The plan, **group-first** (group = task): each group in plan order under a header row (derived status
 * icon + title + done/total badge), then the loose lane — the user's own items — **last** under a "Your
 * requests" header. The user's lane sits at the end on purpose (mirrors `pi-todos`'s `formatPlan` and the
 * markdown snapshot): a request added mid-task queues *after* the agent's current work, not above it.
 * The `active` group's header is emphasized; a fully-**done** group doesn't list its items — it folds
 * into a single expandable `DoneGroup` row (finished task grouped away but reachable). Empty: the caller.
 */
export function TodoRows({
	plan,
	onRemove,
	glance = "working",
}: {
	plan: TodoPlan;
	onRemove: (id: string) => void;
	glance?: PlanGlance;
}) {
	return (
		<>
			{plan.groups.map((group) => {
				const status = groupStatus(group);
				if (status === "done")
					return <DoneGroup key={group.id} group={group} glance={glance} onRemove={onRemove} />;
				const { done, total } = groupProgress(group);
				return (
					<div key={group.id} className="mb-sm" data-testid="todo-group" data-status={status}>
						<div className="flex items-center gap-sm px-xs py-xs">
							{status === "active" ? (
								<StatusIcon status="in_progress" glance={glance} />
							) : (
								<Circle className="size-4 shrink-0 text-hint" />
							)}
							<span
								className={cn(
									"min-w-0 flex-1 truncate text-sm",
									status === "active" ? "font-medium text-text" : "text-muted",
								)}
							>
								{group.title}
							</span>
							<span
								data-testid="todo-group-progress"
								className="shrink-0 text-[10px] text-hint uppercase tracking-wider"
							>
								{done}/{total}
							</span>
						</div>
						<ul className="ml-md flex flex-col border-border2 border-l pl-sm">
							{group.todos.map((todo) => (
								<TodoRow
									key={todo.id}
									todo={todo}
									glance={glance}
									onRemove={() => onRemove(todo.id)}
								/>
							))}
						</ul>
					</div>
				);
			})}
			{plan.todos.length > 0 ? (
				<div className="mb-sm">
					<div className="px-xs py-xs text-[10px] text-hint uppercase tracking-wider">
						Your requests · {plan.todos.length}
					</div>
					<ul className="flex flex-col">
						{plan.todos.map((todo) => (
							<TodoRow
								key={todo.id}
								todo={todo}
								glance={glance}
								onRemove={() => onRemove(todo.id)}
							/>
						))}
					</ul>
				</div>
			) : null}
		</>
	);
}

/**
 * A fully-completed group, folded into one expandable row (collapsed by default) sunk to the bottom — a
 * finished thread out of the way but reachable. Expands to its items (a plain glyph list).
 */
function DoneGroup({
	group,
	glance,
	onRemove,
}: {
	group: TodoGroupItem;
	glance: PlanGlance;
	onRemove: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<div className="mb-sm">
			<button
				type="button"
				data-testid="todo-group-done"
				data-expanded={expanded}
				onClick={() => setExpanded((v) => !v)}
				className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs text-left hover:bg-hover"
			>
				<Chevron className="size-3.5 shrink-0 text-hint" />
				<Check className="size-4 shrink-0 text-primary" />
				<span className="min-w-0 flex-1 truncate font-medium text-hint text-sm line-through">
					{group.title}
				</span>
				<span className="shrink-0 text-[10px] text-hint uppercase tracking-wider">
					{group.todos.length} done
				</span>
			</button>
			{expanded ? (
				<ul className="ml-md flex flex-col border-border2 border-l pl-sm">
					{group.todos.map((todo) => (
						<TodoRow key={todo.id} todo={todo} glance={glance} onRemove={() => onRemove(todo.id)} />
					))}
				</ul>
			) : null}
		</div>
	);
}

function TodoRow({
	todo,
	glance,
	onRemove,
}: {
	todo: TodoItem;
	glance: PlanGlance;
	onRemove: () => void;
}) {
	return (
		<li
			data-testid="todo-row"
			data-status={todo.status}
			className="group flex items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs hover:bg-hover"
		>
			<span className="shrink-0" title={statusLabel(todo.status, glance)}>
				<StatusIcon status={todo.status} glance={glance} />
			</span>
			<div className="min-w-0 flex-1">
				<div
					className={cn(
						"truncate text-sm",
						todo.status === "done" ? "text-hint line-through" : "text-text",
					)}
				>
					{todo.title}
				</div>
				{todo.note ? (
					<div className="truncate font-[var(--font-mono)] text-[10px] text-hint">{todo.note}</div>
				) : null}
			</div>
			{todo.origin === "user" ? (
				<span
					data-testid="todo-origin-user"
					title="Added by you — the agent won't drop it"
					className="shrink-0 text-hint"
				>
					<UserRound className="size-3.5" />
				</span>
			) : null}
			<button
				type="button"
				onClick={onRemove}
				aria-label="Remove"
				title="Remove"
				className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-hint opacity-0 transition-opacity hover:bg-elevated hover:text-red group-hover:opacity-100 focus-visible:opacity-100"
			>
				<Trash2 className="size-3.5" />
			</button>
		</li>
	);
}
