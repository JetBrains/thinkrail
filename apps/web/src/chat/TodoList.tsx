import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiCircleLine as Circle,
	RiErrorWarningLine as CircleAlert,
	RiCheckboxCircleLine as CircleCheck,
	RiRecordCircleLine as CircleDot,
	RiPauseCircleLine as CirclePause,
	RiCloseLine as Close,
	RiFileTextLine as FileText,
	RiLoaderLine as LoaderCircle,
	RiQuestionnaireLine as MessageCircleQuestion,
	RiAddLine as Plus,
	RiUser3Line as UserRound,
} from "@remixicon/react";
import type { TodoGroupItem, TodoItem, TodoPlan, TodoStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { PlanStatusIcon, SectionLabel } from "./planKit";
import {
	groupProgress,
	type ItemChangeSet,
	itemChangeSet,
	type PlanGlance,
	planSections,
	reviewChangesRequested,
	reviewSettled,
} from "./planView";

export type ChangeTarget = { sha: string } | { path: string };

const STATUS_LABEL = {
	in_progress: "chat.todo.status.inProgress",
	pending: "chat.todo.status.pending",
	done: "chat.todo.status.done",
} satisfies Record<TodoStatus, MessageKey>;

export function glanceIcon(
	t: Translator,
	glance: PlanGlance,
): {
	Icon: typeof CircleDot;
	label: string;
	className: string;
} {
	if (glance === "waiting_question")
		return {
			Icon: MessageCircleQuestion,
			label: t("chat.todo.glance.question"),
			className: "text-primary",
		};
	if (glance === "waiting")
		return {
			Icon: CirclePause,
			label: t("chat.todo.glance.paused"),
			className: "text-text-muted",
		};
	return { Icon: CircleDot, label: t(STATUS_LABEL.in_progress), className: "text-primary" };
}

function statusLabel(t: Translator, status: TodoStatus, glance: PlanGlance): string {
	return status === "in_progress" ? glanceIcon(t, glance).label : t(STATUS_LABEL[status]);
}

export function StatusIcon({
	status,
	glance,
	reviewed = false,
	reviewing = false,
	changesRequested = false,
}: {
	status: TodoStatus;
	glance: PlanGlance;
	reviewed?: boolean;
	reviewing?: boolean;
	changesRequested?: boolean;
}) {
	const t = useT();
	if (reviewing)
		return (
			<LoaderCircle data-reviewing="true" className="size-12 shrink-0 animate-spin text-primary" />
		);
	if (status === "in_progress") {
		const { Icon, className } = glanceIcon(t, glance);
		return <Icon data-glance={glance} className={cn("size-12 shrink-0", className)} />;
	}
	if (status === "done" && changesRequested)
		return (
			<CircleAlert
				data-changes-requested="true"
				className="size-12 shrink-0 text-feedback-warning"
			/>
		);
	if (status === "done" && reviewed)
		return <CircleCheck data-reviewed="true" className="size-12 shrink-0 text-feedback-success" />;
	return <PlanStatusIcon kind={status === "done" ? "done" : "pending"} />;
}

export function TodoAddRow({
	onAdd,
	onOpenPlan,
}: {
	onAdd: (title: string) => Promise<void>;
	onOpenPlan?: () => void;
}) {
	const t = useT();
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
		<div className="flex items-center gap-8 px-8 py-4">
			<Plus className="size-14 shrink-0 text-text-muted" />
			<input
				data-testid="todo-add-input"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") void submit();
				}}
				placeholder={t("chat.todo.addPlaceholder")}
				className="min-w-0 flex-1 bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
			/>
			{onOpenPlan ? (
				<IconButton
					icon={FileText}
					data-testid="todo-open-plan"
					onClick={onOpenPlan}
					label={t("chat.todo.openPlan")}
					tooltip={t("chat.todo.openPlanTooltip")}
					className="shrink-0"
				/>
			) : null}
		</div>
	);
}

function GroupBlock({
	group,
	glance,
	onOpenChanges,
	onRemove,
}: {
	group: TodoGroupItem;
	glance: PlanGlance;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
	onRemove?: ((id: string) => Promise<void>) | undefined;
}) {
	const t = useT();
	const status = group.status;
	const { done, total } = groupProgress(group);
	const empty = group.todos.length === 0;
	return (
		<div
			className="mb-8"
			data-testid="todo-group"
			data-status={status}
			data-empty={empty || undefined}
		>
			<div className="flex items-center gap-8 px-4 py-4">
				{status === "active" ? (
					<StatusIcon status="in_progress" glance={glance} />
				) : (
					<Circle className="size-12 shrink-0 text-text-muted" />
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
					{empty ? t("chat.todo.planning") : `${done}/${total}`}
				</span>
			</div>
			{empty ? (
				<p
					data-testid="todo-group-planning"
					className="ml-12 flex items-center gap-8 border-border-default border-l pl-8 py-4 tr-text-metadata text-text-subtle"
				>
					<LoaderCircle className="size-12 shrink-0 animate-spin text-primary" />
					{t("chat.todo.planForming")}
				</p>
			) : null}
			<ul className="ml-12 flex flex-col border-border-default border-l pl-8">
				{group.todos.map((todo) => (
					<TodoRow
						key={todo.id}
						todo={todo}
						glance={glance}
						onOpenChanges={onOpenChanges}
						onRemove={onRemove}
					/>
				))}
			</ul>
		</div>
	);
}

function LooseList({
	items,
	glance,
	onOpenChanges,
	onRemove,
}: {
	items: TodoItem[];
	glance: PlanGlance;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
	onRemove?: ((id: string) => Promise<void>) | undefined;
}) {
	if (items.length === 0) return null;
	return (
		<ul className="flex flex-col">
			{items.map((todo) => (
				<TodoRow
					key={todo.id}
					todo={todo}
					glance={glance}
					onOpenChanges={onOpenChanges}
					onRemove={onRemove}
				/>
			))}
		</ul>
	);
}

export function TodoRows({
	plan,
	glance = "working",
	onOpenChanges,
	onRemove,
}: {
	plan: TodoPlan;
	glance?: PlanGlance;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
	onRemove?: ((id: string) => Promise<void>) | undefined;
}) {
	const t = useT();
	const s = planSections(plan);
	const hasTodo = s.pendingGroups.length > 0 || s.pendingLoose.length > 0;
	const hasDone = s.doneGroups.length > 0 || s.doneLoose.length > 0;
	const rowProps = { glance, onOpenChanges, onRemove };
	return (
		<>
			{s.activeGroups.map((group) => (
				<GroupBlock key={group.id} group={group} {...rowProps} />
			))}
			<LooseList items={s.activeLoose} {...rowProps} />
			{hasTodo ? <SectionLabel label={t("chat.todo.status.pending")} /> : null}
			{s.pendingGroups.map((group) => (
				<GroupBlock key={group.id} group={group} {...rowProps} />
			))}
			<LooseList items={s.pendingLoose} {...rowProps} />
			{hasDone ? <SectionLabel label={t("chat.todo.status.done")} /> : null}
			{s.doneGroups.map((group) => (
				<DoneGroup key={group.id} group={group} {...rowProps} />
			))}
			<LooseList items={s.doneLoose} {...rowProps} />
		</>
	);
}

function DoneGroup({
	group,
	glance,
	onOpenChanges,
}: {
	group: TodoGroupItem;
	glance: PlanGlance;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<div className="mb-8">
			<button
				type="button"
				data-testid="todo-group-done"
				data-expanded={expanded}
				onClick={() => setExpanded((v) => !v)}
				className="flex w-full items-center gap-8 rounded-sm px-4 py-4 text-left hover:bg-control-bg-hovered"
			>
				<Chevron className="size-16 shrink-0 text-text-muted" />
				<Check className="size-12 shrink-0 text-primary" />
				<span className="min-w-0 flex-1 truncate tr-text-ui text-text-muted">{group.title}</span>
				<span className="shrink-0 tr-text-eyebrow text-text-muted">
					{t("chat.todo.steps", { count: group.todos.length })}
				</span>
			</button>
			{expanded ? (
				<ul className="ml-12 flex flex-col border-border-default border-l pl-8">
					{group.todos.map((todo) => (
						<TodoRow key={todo.id} todo={todo} glance={glance} onOpenChanges={onOpenChanges} />
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
	const t = useT();
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
						? t("chat.todo.reviewCommit", { sha: set.sha.slice(0, 7) })
						: t("chat.todo.reviewFiles")
				}
				className="tr-text-metadata text-text-subtle underline-offset-2 hover:text-text-default hover:underline"
			>
				{t("chat.todo.files", { count })}
			</button>
			{expanded && set.kind === "paths" ? (
				<ul className="mt-4 flex flex-col gap-4">
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
	onOpenChanges,
	onRemove,
}: {
	todo: TodoItem;
	glance: PlanGlance;
	onOpenChanges?: ((target: ChangeTarget) => void) | undefined;
	onRemove?: ((id: string) => Promise<void>) | undefined;
}) {
	const t = useT();
	const changeSet = onOpenChanges ? itemChangeSet(todo) : null;
	const reviewed = reviewSettled(todo);
	const reviewing = todo.review?.reviewing === true;
	const changesRequested = reviewChangesRequested(todo);
	return (
		<li
			data-testid="todo-row"
			data-row
			data-status={todo.status}
			data-reviewed={reviewed}
			data-reviewing={reviewing}
			data-changes-requested={changesRequested}
			className="group flex items-center gap-8 rounded-sm px-4 py-4 hover:bg-control-bg-hovered"
		>
			<span
				className="shrink-0"
				title={
					reviewing
						? t("chat.todo.review.checking")
						: changesRequested && todo.status === "done"
							? t("chat.todo.review.needsFix")
							: reviewed
								? t("chat.todo.review.checked")
								: statusLabel(t, todo.status, glance)
				}
			>
				<StatusIcon
					status={todo.status}
					glance={glance}
					reviewed={reviewed}
					reviewing={reviewing}
					changesRequested={changesRequested}
				/>
			</span>
			<div className="min-w-0 flex-1">
				<div
					className={cn(
						"truncate tr-text-ui",
						todo.status === "done" ? "text-text-muted" : "text-text-default",
					)}
				>
					{todo.title}
				</div>
				{changeSet && onOpenChanges ? (
					<ChangeSetChip set={changeSet} onOpen={onOpenChanges} />
				) : null}
			</div>
			{todo.origin === "user" ? (
				<span
					data-testid="todo-origin-user"
					title={t("chat.todo.userOrigin")}
					className="shrink-0 text-text-muted"
				>
					<UserRound className="size-14" />
				</span>
			) : null}
			{onRemove && todo.status !== "done" && !reviewing ? (
				<IconButton
					icon={Close}
					size="s"
					data-testid="todo-remove"
					label={t("chat.todo.remove")}
					onClick={() => {
						void onRemove(todo.id);
					}}
					className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
				/>
			) : null}
		</li>
	);
}
