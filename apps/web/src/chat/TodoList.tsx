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
import { groupProgress, groupStatus, type PlanGlance, planSections } from "./planView";

// Presentational TODO rendering for the in-chat plan popup (SPEC §Chat TODO plan). Props-driven (no transport) —
// the caller supplies the plan + edit callbacks (see `useChatTodos`) and the glance state (see
// `planView.ts`). The plan reads as a **status flow, group-first** (`planSections`): the **in-progress**
// task (its whole group) on top with no header, then a **To do** section (pending groups, then the
// user's pending loose items), then a single titled, collapsed **Done** section at the very bottom
// (fully-done groups + done loose items). Finished *steps* stay inline in their group; only whole done
// tasks move to Done. The in_progress step's icon follows the glance: working → dot, stopped on a
// question → `?`, stopped otherwise → pause — so the list never claims "in work" while the system waits.
// Status is read-only (agent-owned); the user's edit surface is add + remove.

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

/** A non-done task group (active or pending): a header row (status icon + title + done/total) with its
 * steps indented — finished steps stay inline (checked + struck through). */
function GroupBlock({
	group,
	glance,
	onRemove,
}: {
	group: TodoGroupItem;
	glance: PlanGlance;
	onRemove: (id: string) => void;
}) {
	const status = groupStatus(group);
	const { done, total } = groupProgress(group);
	return (
		<div className="mb-sm" data-testid="todo-group" data-status={status}>
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
					<TodoRow key={todo.id} todo={todo} glance={glance} onRemove={() => onRemove(todo.id)} />
				))}
			</ul>
		</div>
	);
}

/** A flat list of loose items (the user's own adds) as rows — each carries the `user` badge. */
function LooseList({
	items,
	glance,
	onRemove,
}: {
	items: TodoItem[];
	glance: PlanGlance;
	onRemove: (id: string) => void;
}) {
	if (items.length === 0) return null;
	return (
		<ul className="flex flex-col">
			{items.map((todo) => (
				<TodoRow key={todo.id} todo={todo} glance={glance} onRemove={() => onRemove(todo.id)} />
			))}
		</ul>
	);
}

/** A section header (`To do`), the quiet uppercase label shared by the status sections. */
function SectionLabel({ label }: { label: string }) {
	return <div className="px-xs py-xs text-[10px] text-hint uppercase tracking-wider">{label}</div>;
}

/**
 * The plan as a **status flow** (`planSections`): the in-progress task (its whole group) first with no
 * header, then a **To do** section (pending groups, then the user's pending loose items), then the
 * collapsed **Done** section at the very bottom. Finished steps stay inline in their group. Empty: the
 * caller renders the placeholder.
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
	const s = planSections(plan);
	const hasTodo = s.pendingGroups.length > 0 || s.pendingLoose.length > 0;
	const hasDone = s.doneGroups.length > 0 || s.doneLoose.length > 0;
	return (
		<>
			{s.activeGroups.map((group) => (
				<GroupBlock key={group.id} group={group} glance={glance} onRemove={onRemove} />
			))}
			<LooseList items={s.activeLoose} glance={glance} onRemove={onRemove} />
			{hasTodo ? <SectionLabel label="To do" /> : null}
			{s.pendingGroups.map((group) => (
				<GroupBlock key={group.id} group={group} glance={glance} onRemove={onRemove} />
			))}
			<LooseList items={s.pendingLoose} glance={glance} onRemove={onRemove} />
			{hasDone ? (
				<DoneSection
					groups={s.doneGroups}
					loose={s.doneLoose}
					glance={glance}
					onRemove={onRemove}
				/>
			) : null}
		</>
	);
}

/**
 * The single titled, collapsed **Done** section at the bottom — finished tasks and done loose items,
 * out of the way but reachable. Collapsed by default; expands to the done groups (each under its struck
 * title) then the done loose items. Count = total done steps across them.
 */
function DoneSection({
	groups,
	loose,
	glance,
	onRemove,
}: {
	groups: TodoGroupItem[];
	loose: TodoItem[];
	glance: PlanGlance;
	onRemove: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const count = groups.reduce((n, g) => n + g.todos.length, 0) + loose.length;
	return (
		<div className="mb-sm">
			<button
				type="button"
				data-testid="todo-done-section"
				data-expanded={expanded}
				onClick={() => setExpanded((v) => !v)}
				className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs text-left hover:bg-hover"
			>
				<Chevron className="size-3.5 shrink-0 text-hint" />
				<Check className="size-4 shrink-0 text-primary" />
				<span className="min-w-0 flex-1 truncate font-medium text-hint text-sm">Done</span>
				<span className="shrink-0 text-[10px] text-hint uppercase tracking-wider">{count}</span>
			</button>
			{expanded ? (
				<div className="ml-md flex flex-col border-border2 border-l pl-sm">
					{groups.map((group) => (
						<div key={group.id} data-testid="todo-group-done" className="mb-sm">
							<div className="truncate px-xs py-xs text-hint text-sm line-through">
								{group.title}
							</div>
							<ul className="flex flex-col">
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
					))}
					<LooseList items={loose} glance={glance} onRemove={onRemove} />
				</div>
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
