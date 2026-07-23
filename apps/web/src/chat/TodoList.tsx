import type { TodoGroupItem, TodoItem, TodoPlan, TodoStatus } from "@thinkrail/contracts";
import {
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	CircleDot,
	FileText,
	Plus,
	Trash2,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../lib";

// Presentational TODO rendering for the in-chat plan popup (SPEC §Chat TODO plan). Props-driven (no transport) —
// the caller supplies the plan + edit callbacks (see `useChatTodos`). The plan renders as three status
// sections (In progress / To do / Done); every item (loose or grouped) falls into the section for its
// status. The one exception is Done: a group whose every item is done folds into one expandable row
// instead of listing its items. Status is read-only (agent-owned); the user's edit surface is add + remove.

/** The three status sections, in display order (also the single source for each status's label). */
const STATUS_SECTIONS: { status: TodoStatus; label: string }[] = [
	{ status: "in_progress", label: "In progress" },
	{ status: "pending", label: "To do" },
	{ status: "done", label: "Done" },
];

const STATUS_LABEL = Object.fromEntries(STATUS_SECTIONS.map((s) => [s.status, s.label])) as Record<
	TodoStatus,
	string
>;

function StatusIcon({ status }: { status: TodoStatus }) {
	if (status === "done") return <Check className="size-4 shrink-0 text-primary" />;
	if (status === "in_progress") return <CircleDot className="size-4 shrink-0 text-primary" />;
	return <Circle className="size-4 shrink-0 text-hint" />;
}

/** Every item across loose + groups, in display order. */
function flatItems(plan: TodoPlan): TodoItem[] {
	return [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
}

/** done / total and the current in-progress item — the "what's happening now" glance. */
export function planSummary(plan: TodoPlan): {
	done: number;
	total: number;
	current: TodoItem | undefined;
} {
	const all = flatItems(plan);
	return {
		done: all.filter((t) => t.status === "done").length,
		total: all.length,
		current: all.find((t) => t.status === "in_progress"),
	};
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

function isGroupDone(group: TodoGroupItem): boolean {
	return group.todos.length > 0 && group.todos.every((t) => t.status === "done");
}

/**
 * The plan is three **status** sections — In progress / To do / Done — and every item (loose or grouped)
 * falls into the section matching its own status; groups are otherwise invisible. The one exception is
 * **Done**: a group whose every item is done doesn't list its items individually — it folds into a single
 * expandable `DoneGroup` row (finished thread grouped away but reachable). Empty state: the caller.
 */
export function TodoRows({ plan, onRemove }: { plan: TodoPlan; onRemove: (id: string) => void }) {
	const all = flatItems(plan);
	const doneGroups = plan.groups.filter(isGroupDone);
	// Items inside a fully-done group are shown as the folded group row, not individually.
	const folded = new Set(doneGroups.flatMap((g) => g.todos.map((t) => t.id)));
	return (
		<>
			{STATUS_SECTIONS.map(({ status, label }) => {
				const items = all.filter((t) => t.status === status && !folded.has(t.id));
				const groups = status === "done" ? doneGroups : [];
				if (items.length === 0 && groups.length === 0) return null;
				const count = items.length + groups.reduce((n, g) => n + g.todos.length, 0);
				return (
					<div key={status} className="mb-sm">
						<div className="px-xs py-xs text-[10px] text-hint uppercase tracking-wider">
							{label} · {count}
						</div>
						{items.length > 0 ? (
							<ul className="flex flex-col">
								{items.map((todo) => (
									<TodoRow key={todo.id} todo={todo} onRemove={() => onRemove(todo.id)} />
								))}
							</ul>
						) : null}
						{groups.map((group) => (
							<DoneGroup key={group.id} group={group} onRemove={onRemove} />
						))}
					</div>
				);
			})}
		</>
	);
}

/**
 * A fully-completed group, folded into one expandable row (collapsed by default) sunk to the bottom — a
 * finished thread out of the way but reachable. Expands to its items (a plain glyph list).
 */
function DoneGroup({ group, onRemove }: { group: TodoGroupItem; onRemove: (id: string) => void }) {
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
						<TodoRow key={todo.id} todo={todo} onRemove={() => onRemove(todo.id)} />
					))}
				</ul>
			) : null}
		</div>
	);
}

function TodoRow({ todo, onRemove }: { todo: TodoItem; onRemove: () => void }) {
	return (
		<li
			data-testid="todo-row"
			data-status={todo.status}
			className="group flex items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs hover:bg-hover"
		>
			<span className="shrink-0" title={STATUS_LABEL[todo.status]}>
				<StatusIcon status={todo.status} />
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
