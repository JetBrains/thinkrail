import type { TodoGroupItem, TodoItem, TodoPlan, TodoStatus } from "@thinkrail/contracts";
import {
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	CircleDot,
	CirclePause,
	FileText,
	MessageCircleQuestion,
	Plus,
	Trash2,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../lib";
import { PlanStatusIcon, SectionLabel } from "./planKit";
import {
	groupProgress,
	type ItemChangeSet,
	itemChangeSet,
	type PlanGlance,
	planSections,
} from "./planView";

export type ChangeTarget = { sha: string } | { path: string };

const STATUS_LABEL: Record<TodoStatus, string> = {
	in_progress: "In progress",
	pending: "To do",
	done: "Done",
};

export function glanceIcon(glance: PlanGlance): {
	Icon: typeof CircleDot;
	label: string;
	className: string;
} {
	if (glance === "waiting_question")
		return {
			Icon: MessageCircleQuestion,
			label: "Waiting for your answer",
			className: "text-primary",
		};
	if (glance === "waiting")
		return { Icon: CirclePause, label: "Paused", className: "text-text-muted" };
	return { Icon: CircleDot, label: STATUS_LABEL.in_progress, className: "text-primary" };
}

function statusLabel(status: TodoStatus, glance: PlanGlance): string {
	return status === "in_progress" ? glanceIcon(glance).label : STATUS_LABEL[status];
}

export function StatusIcon({ status, glance }: { status: TodoStatus; glance: PlanGlance }) {
	if (status === "in_progress") {
		const { Icon, className } = glanceIcon(glance);
		return <Icon data-glance={glance} className={cn("size-4 shrink-0", className)} />;
	}
	return <PlanStatusIcon kind={status === "done" ? "done" : "pending"} />;
}

export function TodoAddRow({
	onAdd,
	onOpenPlan,
}: {
	onAdd: (title: string) => Promise<void>;
	onOpenPlan?: () => void;
}) {
	const [draft, setDraft] = useState("");
	const submit = async () => {
		const title = draft.trim();
		if (!title) return;
		try {
			await onAdd(title);
			setDraft("");
		} catch {}
	};
	return (
		<div className="flex items-center gap-sm px-sm py-xs">
			<Plus className="size-3.5 shrink-0 text-text-muted" />
			<input
				data-testid="todo-add-input"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") void submit();
				}}
				placeholder="Add a TODO for the agent…"
				className="min-w-0 flex-1 bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
			/>
			{onOpenPlan ? (
				<button
					type="button"
					data-testid="todo-open-plan"
					onClick={onOpenPlan}
					aria-label="Open the plan page"
					title="Open the plan as a page — review each step's changes"
					className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default focus-visible:opacity-100"
				>
					<FileText className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}

function GroupBlock({
	group,
	glance,
	onRemove,
	onOpenChanges,
}: {
	group: TodoGroupItem;
	glance: PlanGlance;
	onRemove: (id: string) => void;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
}) {
	const status = group.status;
	const { done, total } = groupProgress(group);
	return (
		<div className="mb-sm" data-testid="todo-group" data-status={status}>
			<div className="flex items-center gap-sm px-xs py-xs">
				{status === "active" ? (
					<StatusIcon status="in_progress" glance={glance} />
				) : (
					<Circle className="size-4 shrink-0 text-text-muted" />
				)}
				<span
					className={cn(
						"min-w-0 flex-1 truncate",
						status === "active"
							? "tr-title-compact text-text-default"
							: "tr-text-ui text-text-muted",
					)}
				>
					{group.title}
				</span>
				<span
					data-testid="todo-group-progress"
					className="shrink-0 tr-text-eyebrow text-text-muted"
				>
					{done}/{total}
				</span>
			</div>
			<ul className="ml-md flex flex-col border-border-default border-l pl-sm">
				{group.todos.map((todo) => (
					<TodoRow
						key={todo.id}
						todo={todo}
						glance={glance}
						onRemove={() => onRemove(todo.id)}
						onOpenChanges={onOpenChanges}
					/>
				))}
			</ul>
		</div>
	);
}

function LooseList({
	items,
	glance,
	onRemove,
	onOpenChanges,
}: {
	items: TodoItem[];
	glance: PlanGlance;
	onRemove: (id: string) => void;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
}) {
	if (items.length === 0) return null;
	return (
		<ul className="flex flex-col">
			{items.map((todo) => (
				<TodoRow
					key={todo.id}
					todo={todo}
					glance={glance}
					onRemove={() => onRemove(todo.id)}
					onOpenChanges={onOpenChanges}
				/>
			))}
		</ul>
	);
}

export function TodoRows({
	plan,
	onRemove,
	glance = "working",
	onOpenChanges,
}: {
	plan: TodoPlan;
	onRemove: (id: string) => void;
	glance?: PlanGlance;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
}) {
	const s = planSections(plan);
	const hasTodo = s.pendingGroups.length > 0 || s.pendingLoose.length > 0;
	const hasDone = s.doneGroups.length > 0 || s.doneLoose.length > 0;
	const rowProps = { glance, onOpenChanges };
	return (
		<>
			{s.activeGroups.map((group) => (
				<GroupBlock key={group.id} group={group} onRemove={onRemove} {...rowProps} />
			))}
			<LooseList items={s.activeLoose} onRemove={onRemove} {...rowProps} />
			{hasTodo ? <SectionLabel label="To do" /> : null}
			{s.pendingGroups.map((group) => (
				<GroupBlock key={group.id} group={group} onRemove={onRemove} {...rowProps} />
			))}
			<LooseList items={s.pendingLoose} onRemove={onRemove} {...rowProps} />
			{hasDone ? <SectionLabel label="Done" /> : null}
			{s.doneGroups.map((group) => (
				<DoneGroup key={group.id} group={group} onRemove={onRemove} {...rowProps} />
			))}
			<LooseList items={s.doneLoose} onRemove={onRemove} {...rowProps} />
		</>
	);
}

function DoneGroup({
	group,
	glance,
	onRemove,
	onOpenChanges,
}: {
	group: TodoGroupItem;
	glance: PlanGlance;
	onRemove: (id: string) => void;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
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
				className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs text-left hover:bg-control-bg-hovered"
			>
				<Chevron className="size-3.5 shrink-0 text-text-muted" />
				<Check className="size-4 shrink-0 text-primary" />
				<span className="min-w-0 flex-1 truncate tr-text-ui text-text-muted line-through">
					{group.title}
				</span>
				<span className="shrink-0 tr-text-eyebrow text-text-muted">{group.todos.length} done</span>
			</button>
			{expanded ? (
				<ul className="ml-md flex flex-col border-border-default border-l pl-sm">
					{group.todos.map((todo) => (
						<TodoRow
							key={todo.id}
							todo={todo}
							glance={glance}
							onRemove={() => onRemove(todo.id)}
							onOpenChanges={onOpenChanges}
						/>
					))}
				</ul>
			) : null}
		</div>
	);
}

function ChangeSetChip({
	set,
	onOpen,
}: {
	set: ItemChangeSet;
	onOpen: (target: ChangeTarget) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const count = set.kind === "commit" ? set.files.length : set.paths.length;
	const open = () => {
		if (set.kind === "commit") return onOpen({ sha: set.sha });
		if (set.paths.length === 1 && set.paths[0]) return onOpen({ path: set.paths[0] });
		setExpanded((v) => !v);
	};
	return (
		<div className="min-w-0">
			<button
				type="button"
				data-testid="todo-changes-chip"
				data-kind={set.kind}
				onClick={open}
				title={
					set.kind === "commit"
						? `Review this step's changes (commit ${set.sha.slice(0, 7)})`
						: "Review this step's changed files"
				}
				className="tr-text-metadata text-text-subtle underline-offset-2 hover:text-text-default hover:underline"
			>
				{count} {count === 1 ? "file" : "files"}
			</button>
			{expanded && set.kind === "paths" ? (
				<ul className="mt-xs flex flex-col gap-xs">
					{set.paths.map((path) => (
						<li key={path}>
							<button
								type="button"
								data-testid="todo-change-path"
								onClick={() => onOpen({ path })}
								title={path}
								className="block max-w-full truncate tr-text-metadata text-text-subtle hover:text-text-default hover:underline"
							>
								{path}
							</button>
						</li>
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
	onOpenChanges,
}: {
	todo: TodoItem;
	glance: PlanGlance;
	onRemove: () => void;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
}) {
	const changeSet = onOpenChanges ? itemChangeSet(todo) : null;
	return (
		<li
			data-testid="todo-row"
			data-status={todo.status}
			className="group flex items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs hover:bg-control-bg-hovered"
		>
			<span className="shrink-0" title={statusLabel(todo.status, glance)}>
				<StatusIcon status={todo.status} glance={glance} />
			</span>
			<div className="min-w-0 flex-1">
				<div
					className={cn(
						"truncate tr-text-ui",
						todo.status === "done" ? "text-text-muted line-through" : "text-text-default",
					)}
				>
					{todo.title}
				</div>
				{todo.note ? (
					<div className="truncate text-text-muted tr-text-metadata">{todo.note}</div>
				) : null}
				{changeSet && onOpenChanges ? (
					<ChangeSetChip set={changeSet} onOpen={onOpenChanges} />
				) : null}
			</div>
			{todo.origin === "user" ? (
				<span
					data-testid="todo-origin-user"
					title="Added by you — the agent won't drop it"
					className="shrink-0 text-text-muted"
				>
					<UserRound className="size-3.5" />
				</span>
			) : null}
			<button
				type="button"
				onClick={onRemove}
				aria-label="Remove"
				title="Remove"
				className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-0 transition-opacity hover:bg-container-elevated-bg hover:text-feedback-error group-hover:opacity-100 focus-visible:opacity-100"
			>
				<Trash2 className="size-3.5" />
			</button>
		</li>
	);
}
