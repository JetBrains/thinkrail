import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileCopyLine as Copy,
	RiDownloadLine as Download,
	RiGitCommitLine as GitCommitHorizontal,
} from "@remixicon/react";
import type { GitFileChange, TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import { useState } from "react";
import { planToMarkdown } from "../chat/planMarkdown";
import {
	changeSetStat,
	groupProgress,
	itemChangeSet,
	planSections,
	planSummary,
	statusLetter,
} from "../chat/planView";
import { StatusIcon } from "../chat/TodoList";
import { useChatTodos } from "../chat/useChatTodos";
import { selectChatTitle, useAppStore } from "../store";
import { statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { openDiffInTab } from "./openTabs";

function FileStatusLetter({ status }: { status: GitFileChange["status"] }) {
	return (
		<span className={`w-16 shrink-0 text-center tr-text-metadata ${statusNameClass(status)}`}>
			{statusLetter(status)}
		</span>
	);
}

function FileRow({ file, onOpen }: { file: GitFileChange; onOpen: () => void }) {
	return (
		<li>
			<button
				type="button"
				data-testid="plan-file-row"
				onClick={onOpen}
				title={file.path}
				className="flex w-full min-w-0 items-center gap-8 rounded-[var(--radius-sm)] px-4 py-4 text-left hover:bg-control-bg-hovered"
			>
				<FileStatusLetter status={file.status} />
				<span
					className={`min-w-0 flex-1 truncate tr-text-ui text-text-muted ${statusNameClass(file.status)}`}
				>
					{file.path}
				</span>
				<DiffStatBadge added={file.added ?? 0} removed={file.removed ?? 0} />
			</button>
		</li>
	);
}

function ChangeSetBlock({
	item,
	workspaceId,
	onOpenCommit,
}: {
	item: TodoItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const set = itemChangeSet(item);
	if (!set) return null;
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const stat = set.kind === "commit" ? changeSetStat(set.files) : null;
	const count = set.kind === "paths" ? set.paths.length : (stat?.count ?? 0);
	return (
		<div
			className="mt-4"
			data-testid="plan-change-set"
			data-kind={set.kind}
			data-expanded={expanded}
		>
			<div className="flex items-center gap-8 px-4">
				<button
					type="button"
					data-testid="plan-change-set-toggle"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					title={expanded ? "Hide changed files" : "Show changed files"}
					className="flex min-w-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 text-left hover:bg-control-bg-hovered"
				>
					<Chevron className="size-16 shrink-0 text-text-muted" />
					<span className="shrink-0 tr-text-metadata text-text-subtle">
						{count} {count === 1 ? "file" : "files"}
					</span>
				</button>
				{set.kind === "commit" ? (
					<>
						<button
							type="button"
							data-testid="plan-commit-chip"
							onClick={() => onOpenCommit(set.sha)}
							title="Open this step's commit in the Changes panel"
							className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-code-text text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
						>
							<GitCommitHorizontal className="size-14" />
							{set.sha.slice(0, 7)}
						</button>
						<DiffStatBadge added={stat?.added ?? 0} removed={stat?.removed ?? 0} />
					</>
				) : null}
			</div>
			{expanded ? (
				set.kind === "paths" ? (
					<ul className="flex flex-col">
						{set.paths.map((path) => (
							<FileRow
								key={path}
								file={{ path, status: "modified" }}
								onOpen={() => void openDiffInTab(workspaceId, { kind: "branch" }, path, "preview")}
							/>
						))}
					</ul>
				) : (
					<ul className="flex flex-col">
						{set.files.map((file) => (
							<FileRow
								key={file.path}
								file={file}
								onOpen={() =>
									void openDiffInTab(
										workspaceId,
										{ kind: "commit", sha: set.sha },
										file.path,
										"preview",
									)
								}
							/>
						))}
					</ul>
				)
			) : null}
		</div>
	);
}

function ItemBlock({
	item,
	workspaceId,
	onOpenCommit,
}: {
	item: TodoItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
}) {
	return (
		<li data-testid="plan-item" data-status={item.status} className="py-4">
			<div className="flex items-start gap-8">
				<span className="mt-2">
					<StatusIcon status={item.status} glance="working" />
				</span>
				<div className="min-w-0 flex-1">
					<div
						className={
							item.status === "done" ? "tr-text-ui text-text-muted" : "tr-text-ui text-text-default"
						}
					>
						{item.title}
					</div>
					{item.note ? <div className="tr-text-metadata text-text-subtle">{item.note}</div> : null}
					<ChangeSetBlock item={item} workspaceId={workspaceId} onOpenCommit={onOpenCommit} />
				</div>
			</div>
		</li>
	);
}

function GroupSection({
	group,
	workspaceId,
	onOpenCommit,
}: {
	group: TodoGroupItem;
	workspaceId: string;
	onOpenCommit: (sha: string) => void;
}) {
	const { done, total } = groupProgress(group);
	return (
		<section className="mb-16" data-testid="plan-group">
			<h2 className="mb-4 flex items-baseline gap-8 border-border-default border-b pb-4 tr-title-compact text-text-default">
				<span className="min-w-0 flex-1 truncate">{group.title}</span>
				<span className="shrink-0 tr-text-eyebrow text-text-subtle">
					{done}/{total}
				</span>
			</h2>
			<ul className="flex flex-col">
				{group.todos.map((item) => (
					<ItemBlock
						key={item.id}
						item={item}
						workspaceId={workspaceId}
						onOpenCommit={onOpenCommit}
					/>
				))}
			</ul>
		</section>
	);
}

function downloadMarkdown(markdown: string, title: string): void {
	const blob = new Blob([markdown], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `plan-${title.replace(/[^\w-]+/g, "-").toLowerCase() || "chat"}.md`;
	a.click();
	URL.revokeObjectURL(url);
}

export default function PlanPane({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	const plan = useChatTodos(workspaceId, sessionId);
	const title = useAppStore((s) => selectChatTitle(s, workspaceId, sessionId));
	const pushToast = useAppStore((s) => s.pushToast);

	if (plan.data === null) {
		return (
			<div className="flex h-full items-center justify-center text-text-subtle tr-text-ui">
				{plan.failed ? "Couldn't load the plan." : "Loading…"}
			</div>
		);
	}
	const data = plan.data;
	const { done, total } = planSummary(data);
	const sections = planSections(data);
	const groups = [...sections.activeGroups, ...sections.pendingGroups, ...sections.doneGroups];
	const loose = [...sections.activeLoose, ...sections.pendingLoose, ...sections.doneLoose];
	const empty = groups.length === 0 && loose.length === 0;
	const onOpenCommit = (sha: string) => plan.openChanges({ sha });
	const exportMarkdown = () => planToMarkdown(data, title);

	return (
		<div data-testid="plan-pane" className="h-full overflow-auto bg-container-content-bg">
			<div className="mx-auto max-w-[52rem] px-16 py-16">
				<header className="mb-16 flex items-center gap-12">
					<div className="min-w-0 flex-1">
						<h1 className="truncate tr-title-section text-text-default">Plan · {title}</h1>
						<div data-testid="plan-progress" className="tr-text-metadata text-text-subtle">
							{done}/{total} done
						</div>
					</div>
					<button
						type="button"
						data-testid="plan-copy-markdown"
						onClick={() => {
							void navigator.clipboard
								.writeText(exportMarkdown())
								.then(() =>
									pushToast({
										variant: "success",
										title: "Plan copied",
										message: "Markdown is in your clipboard.",
									}),
								)
								.catch(() =>
									pushToast({
										variant: "error",
										title: "Copy failed",
										message: "Couldn't write to the clipboard.",
									}),
								);
						}}
						title="Copy the plan as markdown"
						className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 py-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Copy className="size-14" /> Copy
					</button>
					<button
						type="button"
						data-testid="plan-save-markdown"
						onClick={() => downloadMarkdown(exportMarkdown(), title)}
						title="Save the plan as a .md file"
						className="flex shrink-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 py-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Download className="size-14" /> Save .md
					</button>
				</header>
				{empty ? (
					<p className="text-text-subtle tr-text-ui">
						No items yet — the agent adds its plan here.
					</p>
				) : (
					<>
						{groups.map((group) => (
							<GroupSection
								key={group.id}
								group={group}
								workspaceId={workspaceId}
								onOpenCommit={onOpenCommit}
							/>
						))}
						{loose.length > 0 ? (
							<section className="mb-16" data-testid="plan-loose">
								{groups.length > 0 ? (
									<h2 className="mb-4 border-border-default border-b pb-4 tr-title-compact text-text-default">
										Other
									</h2>
								) : null}
								<ul className="flex flex-col">
									{loose.map((item) => (
										<ItemBlock
											key={item.id}
											item={item}
											workspaceId={workspaceId}
											onOpenCommit={onOpenCommit}
										/>
									))}
								</ul>
							</section>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}
