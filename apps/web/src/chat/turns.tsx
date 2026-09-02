import {
	RiBookOpenLine as BookOpen,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiArrowUpSLine as ChevronUp,
	RiTimeLine as Clock,
	RiFileTextLine as FileText,
	RiContractUpDownLine as FoldVertical,
	RiLoopRightLine as RotateCw,
	RiAlertLine as TriangleAlert,
	RiToolsLine as Wrench,
} from "@remixicon/react";
import type { ImageContent, UserMessage } from "@thinkrail/contracts";
import { type ReactNode, useEffect, useState } from "react";
import { CustomIcon } from "@/components/CustomIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	cn,
	parseSkillInvocation,
	projectRelativePath,
	type SkillInvocation,
	userText,
} from "@/lib";
import { ActivityGroup } from "./ActivityGroup";
import { AssistantMarkdown } from "./assistantLinks";
import { CopyButton } from "./CopyButton";
import { FileChip } from "./FileChip";
import { useFold, useSelection } from "./foldState";
import { Markdown } from "./Markdown";
import { parseReviewPackage, type ReviewPackageItem, reviewPackageLabel } from "./reviewPackage";
import type { ChatRow, TurnDividerData } from "./rows";
import { formatElapsed, formatTokens } from "./SessionStatsBar";
import { ToolCard } from "./ToolCard";
import { ToolRendererBody } from "./ToolRendererBody";
import { getToolChrome, getToolSummary, type ToolRenderProps } from "./toolRegistry";
import { SubagentCompletionCard } from "./tools/subagent/SubagentCompletionCard";
import type { CompactionState } from "./types";

export function ChatTurnView({
	row,
	workspaceRoot,
	onOpenFile,
	agentResponded,
	isFinalAnswer,
	onOpenSpec,
	onOpenChange,
	onReveal,
	onTryAgain,
}: {
	row: ChatRow;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	agentResponded: boolean;
	isFinalAnswer: boolean;
	onOpenSpec?: ((path: string) => void) | undefined;
	onOpenChange?: ((path: string) => void) | undefined;
	onReveal?: ((tab: "specs" | "changes") => void) | undefined;
	onTryAgain?: (() => void) | undefined;
}) {
	switch (row.kind) {
		case "user":
			return (
				<UserTurn
					id={row.id}
					message={row.message}
					attachmentNames={row.attachmentNames}
					agentResponded={agentResponded}
				/>
			);
		case "system":
			return <SystemTurn text={row.text} />;
		case "error":
			return (
				<ErrorTurn
					text={row.text}
					onTryAgain={row.recovery === "try-again" ? onTryAgain : undefined}
				/>
			);
		case "compaction":
			return row.summary !== undefined && row.tokensBefore !== undefined ? (
				<CompactionTurn
					id={row.id}
					summary={row.summary}
					tokensBefore={row.tokensBefore}
					tokensAfter={row.tokensAfter}
					resuming={row.resuming}
				/>
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
			return isFinalAnswer ? (
				<MessageWithCopy messageRole="assistant" side="left" getText={() => row.text}>
					<div className="w-full min-w-0 pl-24 tr-text-reading text-text-default [&>div>*:last-child]:mb-0 [&_ol]:list-inside [&_ul]:list-inside">
						<AssistantMarkdown
							text={row.text}
							workspaceRoot={workspaceRoot}
							onOpenFile={onOpenFile}
						/>
					</div>
				</MessageWithCopy>
			) : (
				<div
					data-testid="chat-message"
					data-role="assistant"
					className="tr-text-reading text-text-default"
				>
					<AssistantMarkdown
						text={row.text}
						workspaceRoot={workspaceRoot}
						onOpenFile={onOpenFile}
					/>
				</div>
			);
		case "subagentCompletion":
			return <SubagentCompletionCard id={row.id} details={row.details} text={row.text} />;
		case "tool":
			return <ToolRow row={row} workspaceRoot={workspaceRoot} onOpenFile={onOpenFile} />;
		case "activity":
			return (
				<ActivityGroup
					id={row.id}
					steps={row.steps}
					live={row.live}
					workspaceRoot={workspaceRoot}
					onOpenFile={onOpenFile}
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

const USER_BUBBLE_BASE =
	"whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border border-bubble-user-border bg-clip-padding bg-bubble-user-bg px-12 py-8 tr-text-reading text-text-muted";
const USER_BUBBLE = cn("max-w-[85%]", USER_BUBBLE_BASE);

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
					className="flex max-h-[90vh] w-auto max-w-[95vw] flex-col gap-8"
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
function MessageWithCopy({
	messageRole,
	side,
	getText,
	children,
}: {
	messageRole: "user" | "assistant";
	side: "left" | "right";
	getText: () => string;
	children: ReactNode;
}) {
	return (
		<div
			data-testid="chat-message"
			data-role={messageRole}
			className={cn("group relative flex flex-col", side === "right" ? "items-end" : "items-start")}
		>
			{children}
			<CopyButton
				getText={getText}
				className={cn("absolute z-10", side === "right" ? "right-0 bottom-8" : "bottom-0 left-0")}
			/>
		</div>
	);
}

const LARGE_USER_MESSAGE = 500;

function UserTurn({
	id,
	message,
	attachmentNames,
	agentResponded,
}: {
	id: string;
	message: UserMessage;
	attachmentNames?: string[] | undefined;
	agentResponded: boolean;
}) {
	const text = userText(message.content);
	const attachments = userAttachments(message.content, attachmentNames);
	const skill = parseSkillInvocation(text);
	if (skill) {
		return (
			<div data-testid="chat-message" data-role="user" className="flex justify-end">
				<div className="flex w-full flex-col items-end gap-4">
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
	if (review) {
		return (
			<div data-testid="chat-message" data-role="user" className="flex justify-end">
				<div className={USER_BUBBLE}>
					{attachments.length > 0 ? (
						<div className="flex flex-wrap gap-4 pb-4" data-testid="chat-message-images">
							{attachments.map(({ key, label, img }) => (
								<AttachmentChip key={key} label={label} img={img} />
							))}
						</div>
					) : null}
					<div data-testid="review-package-card" className="whitespace-normal">
						<span data-testid="review-package-summary" className="block text-text-default">
							{reviewPackageLabel(review)}
						</span>
						<ul className="mt-4 flex flex-col">
							{keyPackageItems(review.items).map(({ key, item }) => (
								<PackageCommentRow key={key} foldId={`${id}:${key}`} item={item} />
							))}
						</ul>
					</div>
				</div>
			</div>
		);
	}

	return (
		<PlainUserTurn id={id} text={text} attachments={attachments} agentResponded={agentResponded} />
	);
}

function PlainUserTurn({
	id,
	text,
	attachments,
	agentResponded,
}: {
	id: string;
	text: string;
	attachments: ReturnType<typeof userAttachments>;
	agentResponded: boolean;
}) {
	const large = text.length > LARGE_USER_MESSAGE;
	const [expanded, toggle] = useFold(`${id}:user-collapse`, !agentResponded);
	const collapsed = large && !expanded;
	return (
		<MessageWithCopy messageRole="user" side="right" getText={() => text}>
			<div className="flex w-fit max-w-[85%] flex-col items-end">
				<div className={cn(USER_BUBBLE_BASE, "pr-24")}>
					{attachments.length > 0 ? (
						<div className="flex flex-wrap gap-4 pb-4" data-testid="chat-message-images">
							{attachments.map(({ key, label, img }) => (
								<AttachmentChip key={key} label={label} img={img} />
							))}
						</div>
					) : null}
					<div
						data-testid="user-message-body"
						data-collapsed={collapsed || undefined}
						className={cn(collapsed && "line-clamp-3")}
					>
						{text}
					</div>
					{large ? (
						<button
							type="button"
							data-testid="user-message-toggle"
							aria-expanded={expanded}
							onClick={toggle}
							className="mt-4 flex items-center gap-4 tr-text-metadata text-text-subtle hover:text-text-default"
						>
							{expanded ? (
								<ChevronUp className="size-16 shrink-0" />
							) : (
								<ChevronDown className="size-16 shrink-0" />
							)}
							{expanded ? "Show less" : "Show more"}
						</button>
					) : null}
				</div>
			</div>
		</MessageWithCopy>
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
				className="flex w-full items-center gap-4 px-12 py-8 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
			>
				<BookOpen className="size-14 shrink-0 text-text-muted" aria-hidden="true" />
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
					<ChevronDown className="size-16 shrink-0 text-text-muted" aria-hidden="true" />
				) : (
					<ChevronRight className="size-16 shrink-0 text-text-muted" aria-hidden="true" />
				)}
			</button>
			{expanded ? (
				<div
					data-testid="skill-invocation-content"
					className="border-bubble-user-border border-t px-12 py-8 text-text-muted"
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
				className="flex w-full cursor-pointer select-none items-start gap-4 rounded-[var(--radius-sm)] px-4 py-4 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
			>
				<ChevronRight
					className={cn(
						"mt-2 size-16 shrink-0 text-text-subtle transition-transform",
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
				<pre className="mb-4 ml-16 max-h-128 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-border-muted bg-sunken px-8 py-4 tr-code-text text-text-muted">
					{item.fragment}
				</pre>
			)}
		</li>
	);
}

function ToolRow({
	row,
	workspaceRoot,
	onOpenFile,
}: {
	row: Extract<ChatRow, { kind: "tool" }>;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	if (getToolChrome(row.toolName) === "bare") {
		const renderProps: ToolRenderProps = {
			toolCallId: row.toolCallId,
			toolName: row.toolName,
			args: row.args,
			result: row.tool?.raw,
			status: row.tool?.status ?? (row.dead ? "error" : "running"),
			workspaceRoot,
			onOpenFile,
			streaming: row.streaming,
		};
		return (
			<div className="tr-text-ui text-text-default">
				<ToolRendererBody {...renderProps} imageLabel={getToolSummary(row.toolName, renderProps)} />
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
			onOpenFile={onOpenFile}
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
	tokensAfter,
	resuming,
}: {
	id: string;
	summary: string;
	tokensBefore: number;
	tokensAfter?: number | undefined;
	resuming?: boolean | undefined;
}) {
	const [open, toggle] = useFold(id);
	const label = resuming ? "Context compacted — resuming…" : "Context compacted";
	const tokens =
		tokensAfter === undefined
			? `${formatTokens(tokensBefore)} tokens`
			: `${formatTokens(tokensBefore)} → ${formatTokens(tokensAfter)} tokens`;
	return (
		<div data-testid="chat-compaction" className="flex flex-col gap-8">
			<button
				type="button"
				aria-expanded={open}
				onClick={toggle}
				className="flex items-center gap-8 text-text-muted tr-text-metadata hover:text-text-default"
			>
				<span className="h-px flex-1 bg-border-default" />
				{open ? <ChevronDown className="size-16" /> : <ChevronRight className="size-16" />}
				<span>
					{label} ({tokens})
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

function ErrorTurn({ text, onTryAgain }: { text: string; onTryAgain?: (() => void) | undefined }) {
	return (
		<div
			data-testid="chat-message"
			data-role="error"
			className="flex items-start gap-8 rounded-[var(--radius-sm)] border border-feedback-error-muted bg-clip-padding bg-feedback-error-subtle px-12 py-8 text-feedback-error tr-text-ui"
		>
			<TriangleAlert className="mt-2 size-12 shrink-0" />
			<span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{text}</span>
			{onTryAgain ? (
				<Button
					variant="outline"
					size="sm"
					data-testid="agent-try-again"
					className="shrink-0"
					onClick={onTryAgain}
				>
					<RotateCw className="size-12" />
					Try again
				</Button>
			) : null}
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
				className="flex items-start gap-8 rounded-[var(--radius-md)] border border-feedback-error-muted bg-clip-padding bg-feedback-error-subtle px-12 py-8 text-feedback-error tr-text-ui"
			>
				<TriangleAlert className="mt-2 size-12 shrink-0" />
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
			className="flex items-center justify-center gap-8 text-text-muted tr-text-metadata"
		>
			{status === "running" ? (
				<RotateCw className="size-12 shrink-0 animate-spin" />
			) : (
				<FoldVertical className="size-12 shrink-0" />
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
			className="flex flex-col gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-4 text-text-muted tr-text-metadata"
		>
			<span className="flex items-center gap-4">
				<RotateCw className="size-12 shrink-0" />
				{source === "summarization" ? "Retrying summarization" : "Retrying"} ({attempt}/
				{maxAttempts})…
			</span>
			<div className="h-4 w-full overflow-hidden rounded-full bg-border-default">
				<div
					className={`h-full bg-primary transition-[width] ease-linear ${draining ? "w-0" : "w-full"}`}
					style={{ transitionDuration: `${delayMs}ms` }}
				/>
			</div>
		</div>
	);
}

function FileDiffGlyph({ className }: { className?: string }) {
	return <CustomIcon name="file-diff-line" className={className} />;
}

interface ArtifactGroup {
	id: "specs" | "files";
	icon: typeof FileText | ((props: { className?: string }) => ReactNode);
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
				"flex items-center gap-4 rounded-[var(--radius-sm)] px-4 text-primary hover:bg-control-bg-hovered",
				many && expanded && "bg-control-bg-selected",
			)}
		>
			<Icon className="size-12 shrink-0" />
			{label(paths.length)}
			{many ? (
				expanded ? (
					<ChevronDown className="size-16 shrink-0" />
				) : (
					<ChevronRight className="size-16 shrink-0" />
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
						className="flex w-full items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 text-left hover:bg-control-bg-hovered"
					>
						<Icon className="size-12 shrink-0 text-text-muted" />
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
			icon: FileDiffGlyph,
			paths: changedFiles,
			label: (n) => `${n} ${n === 1 ? "file changed" : "files changed"}`,
			expanded: selected === "files",
			onOpen: onOpenChange,
			reveal: () => onReveal("changes"),
		},
	];
	const groups = allGroups.filter((group) => group.paths.length > 0);

	if (toolCount === 0 && groups.length === 0 && (elapsedMs == null || elapsedMs < 1000)) {
		return <div data-testid="turn-divider" className="my-8 h-px bg-border-muted" />;
	}
	return (
		<div
			data-testid="turn-divider"
			className="my-8 flex flex-col gap-4 text-text-muted tr-text-metadata"
		>
			<div className="flex items-center gap-8">
				<span className="h-px flex-1 bg-border-muted" />
				{toolCount > 0 ? (
					<span className="flex items-center gap-4">
						<Wrench className="size-12 shrink-0" />
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
					<span className="flex items-center gap-4">
						<Clock className="size-12 shrink-0" />
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
