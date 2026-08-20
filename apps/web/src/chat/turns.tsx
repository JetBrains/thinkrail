import type { ImageContent, UserMessage } from "@thinkrail/contracts";
import {
	BookOpen,
	ChevronDown,
	ChevronRight,
	Clock,
	FileDiff,
	FileText,
	FoldVertical,
	RotateCw,
	TriangleAlert,
	Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	cn,
	parseSkillInvocation,
	projectRelativePath,
	type SkillInvocation,
	userText,
} from "@/lib";
import { ActivityGroup } from "./ActivityGroup";
import { FileChip } from "./FileChip";
import { useFold, useSelection } from "./foldState";
import { Markdown } from "./Markdown";
import { parseReviewPackage, type ReviewPackageItem, reviewPackageLabel } from "./reviewPackage";
import type { ChatRow, TurnDividerData } from "./rows";
import { formatTokens } from "./SessionStatsBar";
import { ToolCard } from "./ToolCard";
import { getToolChrome, getToolRenderer } from "./toolRegistry";
import type { CompactionState } from "./types";

export function ChatTurnView({
	row,
	workspaceRoot,
	onOpenSpec,
	onOpenChange,
	onReveal,
}: {
	row: ChatRow;
	workspaceRoot?: string | undefined;
	onOpenSpec?: ((path: string) => void) | undefined;
	onOpenChange?: ((path: string) => void) | undefined;
	onReveal?: ((tab: "specs" | "changes") => void) | undefined;
}) {
	switch (row.kind) {
		case "user":
			return <UserTurn id={row.id} message={row.message} attachmentNames={row.attachmentNames} />;
		case "system":
			return <SystemTurn text={row.text} />;
		case "error":
			return <ErrorTurn text={row.text} />;
		case "compaction":
			return row.summary !== undefined && row.tokensBefore !== undefined ? (
				<CompactionTurn id={row.id} summary={row.summary} tokensBefore={row.tokensBefore} />
			) : (
				<CompactionNotice {...row} />
			);
		case "retry":
			return (
				<RetryIndicator
					source={row.source}
					attempt={row.attempt}
					maxAttempts={row.maxAttempts}
					delayMs={row.delayMs}
				/>
			);
		case "markdown":
			return (
				<div
					data-testid="chat-message"
					data-role="assistant"
					className="tr-text-reading text-text-default"
				>
					<Markdown text={row.text} />
				</div>
			);
		case "tool":
			return <ToolRow row={row} workspaceRoot={workspaceRoot} />;
		case "activity":
			return (
				<ActivityGroup
					id={row.id}
					steps={row.steps}
					live={row.live}
					workspaceRoot={workspaceRoot}
				/>
			);
		case "divider":
			return (
				<TurnDivider
					id={row.id}
					data={row.data}
					workspaceRoot={workspaceRoot}
					onOpenSpec={onOpenSpec ?? (() => {})}
					onOpenChange={onOpenChange ?? (() => {})}
					onReveal={onReveal ?? (() => {})}
				/>
			);
		default:
			return null;
	}
}

function userAttachments(content: UserMessage["content"], names?: string[]) {
	if (typeof content === "string") return [];
	const seen = new Map<string, number>();
	return content
		.filter((c) => c.type === "image")
		.map((img, i) => {
			const tail = img.data.slice(-24);
			const n = seen.get(tail) ?? 0;
			seen.set(tail, n + 1);
			return { key: `${tail}-${n}`, label: names?.[i] ?? img.mimeType, img };
		});
}

const USER_BUBBLE =
	"max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border border-bubble-user-border bg-clip-padding bg-bubble-user-bg px-md py-sm tr-text-reading text-text-muted";

function AttachmentChip({ label, img }: { label: string; img: ImageContent }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<FileChip
				data-testid="chat-attachment-chip"
				title={label}
				aria-label={`View attachment ${label}`}
				onClick={() => setOpen(true)}
				label={label}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					data-testid="chat-attachment-dialog"
					className="flex max-h-[90vh] w-auto max-w-[95vw] flex-col gap-sm"
				>
					<DialogHeader>
						<DialogTitle>{label}</DialogTitle>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-auto">
						<img
							src={`data:${img.mimeType};base64,${img.data}`}
							alt=""
							className="max-h-[80vh] max-w-full rounded-[var(--radius-sm)]"
						/>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

function UserTurn({
	id,
	message,
	attachmentNames,
}: {
	id: string;
	message: UserMessage;
	attachmentNames?: string[] | undefined;
}) {
	const text = userText(message.content);
	const attachments = userAttachments(message.content, attachmentNames);
	const skill = parseSkillInvocation(text);
	if (skill) {
		return (
			<div data-testid="chat-message" data-role="user" className="flex justify-end">
				<div className="flex w-full flex-col items-end gap-xs">
					<SkillInvocationCard foldId={`${id}:skill`} invocation={skill} />
					{skill.userMessage ? (
						<div data-testid="skill-user-request" className={USER_BUBBLE}>
							{skill.userMessage}
						</div>
					) : null}
				</div>
			</div>
		);
	}

	const review = parseReviewPackage(text);
	return (
		<div data-testid="chat-message" data-role="user" className="flex justify-end">
			<div className={USER_BUBBLE}>
				{attachments.length > 0 ? (
					<div className="flex flex-wrap gap-xs pb-xs" data-testid="chat-message-images">
						{attachments.map(({ key, label, img }) => (
							<AttachmentChip key={key} label={label} img={img} />
						))}
					</div>
				) : null}
				{review ? (
					<div data-testid="review-package-card" className="whitespace-normal">
						<span data-testid="review-package-summary" className="block text-text-default">
							{reviewPackageLabel(review)}
						</span>
						<ul className="mt-xs flex flex-col">
							{keyPackageItems(review.items).map(({ key, item }) => (
								<PackageCommentRow key={key} foldId={`${id}:${key}`} item={item} />
							))}
						</ul>
					</div>
				) : (
					text
				)}
			</div>
		</div>
	);
}

function SkillInvocationCard({
	foldId,
	invocation,
}: {
	foldId: string;
	invocation: SkillInvocation;
}) {
	const [expanded, toggle] = useFold(foldId);
	return (
		<div
			data-testid="skill-invocation-card"
			data-expanded={expanded}
			className="max-w-[85%] overflow-hidden rounded-[var(--radius-lg)] border border-bubble-user-border bg-clip-padding bg-bubble-user-bg"
		>
			<button
				type="button"
				data-testid="skill-invocation-toggle"
				aria-expanded={expanded}
				aria-label={`${expanded ? "Hide" : "Show"} instructions for ${invocation.name}`}
				onClick={toggle}
				className="flex w-full items-center gap-xs px-md py-sm text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
			>
				<BookOpen size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
				<span className="shrink-0 tr-text-ui text-text-muted">Skill</span>
				<span className="shrink-0 text-text-subtle" aria-hidden="true">
					·
				</span>
				<span
					data-testid="skill-invocation-name"
					className="min-w-0 flex-1 truncate tr-code-text text-text-default"
				>
					{invocation.name}
				</span>
				{expanded ? (
					<ChevronDown size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
				) : (
					<ChevronRight size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
				)}
			</button>
			{expanded ? (
				<div
					data-testid="skill-invocation-content"
					className="border-bubble-user-border border-t px-md py-sm text-text-muted"
				>
					<Markdown text={invocation.content} />
				</div>
			) : null}
		</div>
	);
}

function keyPackageItems(items: ReviewPackageItem[]): { key: string; item: ReviewPackageItem }[] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const base = `${item.lineRef}·${item.body}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return { key: `${base}·${n}`, item };
	});
}

function PackageCommentRow({ foldId, item }: { foldId: string; item: ReviewPackageItem }) {
	const [expanded, toggle] = useFold(foldId);
	return (
		<li data-testid="review-package-item" data-expanded={expanded}>
			<button
				type="button"
				data-testid="review-package-item-toggle"
				aria-expanded={expanded}
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-start gap-xs rounded-[var(--radius-sm)] px-xs py-xs text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
			>
				<ChevronRight
					className={cn(
						"mt-0.5 size-3 shrink-0 text-text-subtle transition-transform",
						expanded && "rotate-90",
					)}
				/>
				{item.lineRef && (
					<span className="shrink-0 tr-code-text text-text-subtle">{item.lineRef}</span>
				)}
				<span
					className={cn(
						"min-w-0 flex-1 text-text-default",
						expanded ? "whitespace-pre-wrap" : "truncate",
					)}
				>
					{item.body}
				</span>
			</button>
			{expanded && item.fragment && (
				<pre className="mb-xs ml-lg max-h-32 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-border-muted bg-sunken px-sm py-xs tr-code-text text-text-muted">
					{item.fragment}
				</pre>
			)}
		</li>
	);
}

function ToolRow({
	row,
	workspaceRoot,
}: {
	row: Extract<ChatRow, { kind: "tool" }>;
	workspaceRoot?: string | undefined;
}) {
	if (getToolChrome(row.toolName) === "bare") {
		const Renderer = getToolRenderer(row.toolName);
		return (
			<div className="tr-text-ui text-text-default">
				<Renderer
					toolCallId={row.toolCallId}
					toolName={row.toolName}
					args={row.args}
					result={row.tool?.raw}
					status={row.tool?.status ?? (row.dead ? "error" : "running")}
					workspaceRoot={workspaceRoot}
					streaming={row.streaming}
				/>
			</div>
		);
	}
	return (
		<ToolCard
			toolCallId={row.toolCallId}
			toolName={row.toolName}
			args={row.args}
			tool={row.tool}
			dead={row.dead}
			streaming={row.streaming}
			workspaceRoot={workspaceRoot}
		/>
	);
}

function SystemTurn({ text }: { text: string }) {
	return (
		<div
			data-testid="chat-message"
			data-role="system"
			className="text-center text-text-muted tr-text-metadata"
		>
			{text}
		</div>
	);
}

function CompactionTurn({
	id,
	summary,
	tokensBefore,
}: {
	id: string;
	summary: string;
	tokensBefore: number;
}) {
	const [open, toggle] = useFold(id);
	return (
		<div data-testid="chat-compaction" className="flex flex-col gap-sm">
			<button
				type="button"
				aria-expanded={open}
				onClick={toggle}
				className="flex items-center gap-sm text-text-muted tr-text-metadata hover:text-text-default"
			>
				<span className="h-px flex-1 bg-border-default" />
				{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
				<span>
					Earlier messages summarized ({formatTokens(tokensBefore)} tokens of context compacted)
				</span>
				<span className="h-px flex-1 bg-border-default" />
			</button>
			{open ? (
				<div className="tr-text-reading text-text-muted">
					<Markdown text={summary} />
				</div>
			) : null}
		</div>
	);
}

function ErrorTurn({ text }: { text: string }) {
	return (
		<div
			data-testid="chat-message"
			data-role="error"
			className="flex items-start gap-sm rounded-[var(--radius-sm)] border border-feedback-error-muted bg-clip-padding bg-feedback-error-subtle px-md py-sm text-feedback-error tr-text-ui"
		>
			<TriangleAlert className="mt-0.5 size-4 shrink-0" />
			<span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
		</div>
	);
}

function CompactionNotice({
	status,
	detail,
	tokensBefore,
	tokensAfter,
	resuming,
}: CompactionState) {
	if (status === "failed") {
		return (
			<div
				data-testid="compaction-notice"
				data-status="failed"
				className="flex items-start gap-sm rounded-[var(--radius-md)] border border-feedback-error-muted bg-clip-padding bg-feedback-error-subtle px-md py-sm text-feedback-error tr-text-ui"
			>
				<TriangleAlert className="mt-0.5 size-4 shrink-0" />
				<span className="min-w-0 whitespace-pre-wrap break-words">
					{detail || "Compaction failed."}
				</span>
			</div>
		);
	}
	const label =
		status === "running"
			? "Compacting context…"
			: status === "cancelled"
				? "Compaction cancelled"
				: resuming
					? "Context compacted — resuming…"
					: "Context compacted";
	const tokens =
		tokensBefore != null && tokensAfter != null
			? `${formatTokens(tokensBefore)} → ${formatTokens(tokensAfter)} tokens`
			: null;
	return (
		<div
			data-testid="compaction-notice"
			data-status={status}
			className="flex items-center justify-center gap-sm text-text-muted tr-text-metadata"
		>
			{status === "running" ? (
				<RotateCw className="size-3 shrink-0 animate-spin" />
			) : (
				<FoldVertical className="size-3 shrink-0" />
			)}
			<span>{label}</span>
			{tokens ? <span>({tokens})</span> : null}
		</div>
	);
}

function RetryIndicator({
	source,
	attempt,
	maxAttempts,
	delayMs,
}: {
	source: "turn" | "summarization";
	attempt: number;
	maxAttempts: number;
	delayMs: number;
}) {
	const [draining, setDraining] = useState(false);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setDraining(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<div
			data-testid="retry-indicator"
			data-source={source}
			className="flex flex-col gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs text-text-muted tr-text-metadata"
		>
			<span className="flex items-center gap-xs">
				<RotateCw className="size-3 shrink-0" />
				{source === "summarization" ? "Retrying summarization" : "Retrying"} ({attempt}/
				{maxAttempts})…
			</span>
			<div className="h-1 w-full overflow-hidden rounded-full bg-border-default">
				<div
					className={`h-full bg-primary transition-[width] ease-linear ${draining ? "w-0" : "w-full"}`}
					style={{ transitionDuration: `${delayMs}ms` }}
				/>
			</div>
		</div>
	);
}

function formatElapsed(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface ArtifactGroup {
	id: "specs" | "files";
	icon: typeof FileText;
	paths: string[];
	label: (count: number) => string;
	expanded: boolean;
	onOpen: (path: string) => void;
	reveal: () => void;
}

function ArtifactChip({
	group,
	listId,
	onSelect,
}: {
	group: ArtifactGroup;
	listId: string;
	onSelect: () => void;
}) {
	const { id, icon: Icon, paths, label, expanded, onOpen, reveal } = group;
	const many = paths.length > 1;
	const first = paths[0];
	return (
		<button
			type="button"
			data-testid={`turn-divider-${id}`}
			data-expanded={many && expanded ? true : undefined}
			aria-expanded={many ? expanded : undefined}
			aria-controls={many && expanded ? listId : undefined}
			onClick={() => {
				if (!many) {
					if (first) onOpen(first);
					return;
				}
				if (!expanded) reveal();
				onSelect();
			}}
			className={cn(
				"flex items-center gap-xs rounded-[var(--radius-sm)] px-xs text-primary hover:bg-control-bg-hovered",
				many && expanded && "bg-control-bg-selected",
			)}
		>
			<Icon className="size-3 shrink-0" />
			{label(paths.length)}
			{many ? (
				expanded ? (
					<ChevronDown className="size-3 shrink-0" />
				) : (
					<ChevronRight className="size-3 shrink-0" />
				)
			) : null}
		</button>
	);
}

function ArtifactList({
	group,
	listId,
	workspaceRoot,
}: {
	group: ArtifactGroup;
	listId: string;
	workspaceRoot?: string | undefined;
}) {
	const { id, icon: Icon, paths, onOpen } = group;
	const testid = `turn-divider-${id}`;
	return (
		<ul id={listId} data-testid={`${testid}-list`} className="flex flex-col">
			{paths.map((path) => (
				<li key={path}>
					<button
						type="button"
						data-testid={`${testid}-list-item`}
						onClick={() => onOpen(path)}
						title={path}
						className="flex w-full items-center gap-xs rounded-[var(--radius-sm)] px-xs py-0.5 text-left hover:bg-control-bg-hovered"
					>
						<Icon className="size-3 shrink-0 text-text-muted" />
						<span className="min-w-0 flex-1 truncate text-text-muted">
							{projectRelativePath(path, workspaceRoot)}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

export function TurnDivider({
	id,
	data,
	workspaceRoot,
	onOpenSpec,
	onOpenChange,
	onReveal,
}: {
	id: string;
	data: TurnDividerData;
	workspaceRoot?: string | undefined;
	onOpenSpec: (path: string) => void;
	onOpenChange: (path: string) => void;
	onReveal: (tab: "specs" | "changes") => void;
}) {
	const { elapsedMs, toolCount, specs, changedFiles } = data;
	const [selected, select] = useSelection(`${id}:artifacts`);
	const allGroups: ArtifactGroup[] = [
		{
			id: "specs",
			icon: FileText,
			paths: specs,
			label: (n) => `${n} ${n === 1 ? "spec" : "specs"}`,
			expanded: selected === "specs",
			onOpen: onOpenSpec,
			reveal: () => onReveal("specs"),
		},
		{
			id: "files",
			icon: FileDiff,
			paths: changedFiles,
			label: (n) => `${n} ${n === 1 ? "file changed" : "files changed"}`,
			expanded: selected === "files",
			onOpen: onOpenChange,
			reveal: () => onReveal("changes"),
		},
	];
	const groups = allGroups.filter((group) => group.paths.length > 0);

	if (toolCount === 0 && groups.length === 0 && (elapsedMs == null || elapsedMs < 1000)) {
		return <div data-testid="turn-divider" className="my-sm h-px bg-border-muted" />;
	}
	return (
		<div
			data-testid="turn-divider"
			className="my-sm flex flex-col gap-xs text-text-muted tr-text-metadata"
		>
			<div className="flex items-center gap-sm">
				<span className="h-px flex-1 bg-border-muted" />
				{toolCount > 0 ? (
					<span className="flex items-center gap-xs">
						<Wrench className="size-3 shrink-0" />
						{toolCount} {toolCount === 1 ? "tool call" : "tool calls"}
					</span>
				) : null}
				{groups.map((group) => (
					<ArtifactChip
						key={group.id}
						group={group}
						listId={`${id}-${group.id}-list`}
						onSelect={() => select(group.id)}
					/>
				))}
				{elapsedMs != null && elapsedMs >= 1000 ? (
					<span className="flex items-center gap-xs">
						<Clock className="size-3 shrink-0" />
						{formatElapsed(elapsedMs)}
					</span>
				) : null}
				<span className="h-px flex-1 bg-border-muted" />
			</div>
			{groups
				.filter((group) => group.paths.length > 1 && group.expanded)
				.map((group) => (
					<ArtifactList
						key={group.id}
						group={group}
						listId={`${id}-${group.id}-list`}
						workspaceRoot={workspaceRoot}
					/>
				))}
		</div>
	);
}
