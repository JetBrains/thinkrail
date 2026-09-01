import {
	RiCheckLine as Check,
	RiCornerUpRightLine as CornerUpRight,
	RiSaveLine as Save,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { HistoryScope, MessageHit, PromptHit } from "@thinkrail/contracts";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTooltip } from "@/components/ui/tooltip";
import { platformShortcutLabel, relativeTime } from "@/lib";
import {
	type ChatLocationRequest,
	type HistorySearchState,
	type HistorySelection,
	jumpTarget,
	resolveHistorySelection,
	SCOPE_ORDER,
} from "./useHistorySearch";

const SCOPE_LABELS: Record<HistoryScope["kind"], string> = {
	chat: "Chat",
	workspace: "Workspace",
	project: "Project",
	all: "All",
};

const SCOPE_MENU_LABELS: Record<HistoryScope["kind"], string> = {
	chat: "This chat",
	workspace: "Workspace",
	project: "Project",
	all: "Everywhere",
};

const SAVE_SHORTCUT_LABEL = platformShortcutLabel("S");

function escapeRegExp(term: string): string {
	return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, query }: { text: string; query: string }) {
	const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].sort(
		(a, b) => b.length - a.length,
	);
	if (terms.length === 0) return <>{text}</>;
	const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
	let offset = 0;
	const parts = text.split(pattern).map((part) => {
		const start = offset;
		offset += part.length;
		return { text: part, key: `${start}:${part}` };
	});
	return (
		<>
			{parts.map(({ text: part, key }) =>
				terms.includes(part.toLowerCase()) ? (
					<mark key={key} className="rounded-[var(--radius-xs)] bg-primary-soft text-text-default">
						{part}
					</mark>
				) : (
					<span key={key}>{part}</span>
				),
			)}
		</>
	);
}

function DeleteChatButton({
	workspaceId,
	sessionId,
	isSelected,
	onDeleteChat,
}: {
	workspaceId: string | undefined;
	sessionId: string;
	isSelected: boolean;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
}) {
	if (!workspaceId) return null;
	return (
		<IconTooltip label="Move chat to trash">
			<button
				type="button"
				data-testid="history-delete-chat"
				aria-label="Move chat to trash"
				onClick={(event) => {
					event.stopPropagation();
					onDeleteChat(workspaceId, sessionId);
				}}
				className={`flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] p-4 text-text-muted opacity-0 transition hover:bg-container-elevated-bg hover:text-feedback-error group-hover:opacity-100 ${
					isSelected ? "opacity-100" : ""
				}`}
			>
				<Trash2 className="size-14" />
			</button>
		</IconTooltip>
	);
}

function PromptRow({
	hit,
	query,
	scope,
	workspaceName,
	isSelected,
	onPick,
	onSaveAsTemplate,
	onOpenMessage,
	onDeleteChat,
}: {
	hit: PromptHit;
	query: string;
	scope: HistoryScope;
	workspaceName: string | undefined;
	isSelected: boolean;
	onPick: () => void;
	onSaveAsTemplate: () => void;
	onOpenMessage: (target: ChatLocationRequest) => void;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
}) {
	const firstLine = hit.text.split("\n")[0] ?? hit.text;
	const showChip = (scope.kind === "project" || scope.kind === "all") && !!hit.workspaceId;
	const target = jumpTarget(hit);
	return (
		<div
			data-testid="history-item"
			data-kind="prompt"
			data-selected={isSelected}
			className={`group flex w-full items-center gap-4 rounded-[var(--radius-sm)] border-l-2 py-4 pl-8 pr-4 text-left tr-text-ui ${
				isSelected
					? "border-l-primary bg-control-bg-selected text-text-default"
					: "border-l-transparent text-text-muted"
			}`}
		>
			<button
				type="button"
				onClick={onPick}
				className="flex min-w-0 flex-1 items-center gap-8 overflow-hidden text-left"
			>
				<span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis">
					<Highlight text={firstLine} query={query} />
				</span>
				{showChip ? (
					<span className="shrink-0 rounded-full border border-border-default bg-container-workspace-bg px-4 text-text-muted tr-text-metadata">
						{workspaceName ?? "workspace"}
					</span>
				) : null}
				<span className="shrink-0 text-text-muted tr-text-metadata">
					{relativeTime(hit.timestamp)}
				</span>
			</button>
			{isSelected ? (
				<span
					data-testid="history-save-shortcut"
					className="shrink-0 text-text-muted tr-text-metadata"
				>
					{SAVE_SHORTCUT_LABEL}
				</span>
			) : null}
			<IconTooltip label={`Save as template (${SAVE_SHORTCUT_LABEL})`}>
				<button
					type="button"
					data-testid="history-save-template"
					aria-label="Save as template"
					onClick={(e) => {
						e.stopPropagation();
						onSaveAsTemplate();
					}}
					className={`flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] p-4 text-text-muted opacity-0 transition hover:bg-container-elevated-bg hover:text-text-default group-hover:opacity-100 ${
						isSelected ? "opacity-100" : ""
					}`}
				>
					<Save className="size-14" />
				</button>
			</IconTooltip>
			{target ? (
				<>
					{isSelected ? (
						<span
							data-testid="history-jump-shortcut"
							className="shrink-0 text-text-muted tr-text-metadata"
						>
							⇧⏎
						</span>
					) : null}
					<IconTooltip label="⇧⏎ go to chat">
						<button
							type="button"
							data-testid="history-jump"
							aria-label="Go to chat"
							onClick={(e) => {
								e.stopPropagation();
								onOpenMessage(target);
							}}
							className={`flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] p-4 text-text-muted opacity-0 transition hover:bg-container-elevated-bg hover:text-text-default group-hover:opacity-100 ${
								isSelected ? "opacity-100" : ""
							}`}
						>
							<CornerUpRight className="size-14" />
						</button>
					</IconTooltip>
				</>
			) : null}
			<DeleteChatButton
				workspaceId={hit.workspaceId}
				sessionId={hit.sessionId}
				isSelected={isSelected}
				onDeleteChat={onDeleteChat}
			/>
		</div>
	);
}

function MessageRow({
	hit,
	query,
	isSelected,
	onPick,
	onDeleteChat,
}: {
	hit: MessageHit;
	query: string;
	isSelected: boolean;
	onPick: () => void;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
}) {
	const unmapped = !hit.workspaceId;
	return (
		<div
			data-testid="history-item"
			data-kind="message"
			data-selected={isSelected}
			className={`group flex w-full items-center gap-4 rounded-[var(--radius-sm)] border-l-2 pr-4 tr-text-ui ${
				isSelected
					? "border-l-primary bg-control-bg-selected text-text-default"
					: "border-l-transparent text-text-muted"
			}`}
		>
			<button
				type="button"
				onClick={onPick}
				disabled={unmapped}
				className="flex min-w-0 flex-1 flex-col gap-2 px-8 py-4 text-left disabled:cursor-default"
			>
				<span className="flex items-center gap-4 text-text-muted tr-text-metadata">
					<span className="truncate">
						{hit.sessionTitle || hit.cwd.split("/").pop() || "session"}
					</span>
					<span>·</span>
					<span>{hit.role}</span>
					<span>·</span>
					<span>{relativeTime(hit.timestamp)}</span>
					{unmapped ? <span>· not a ThinkRail workspace</span> : null}
				</span>
				<span className="overflow-hidden whitespace-nowrap text-ellipsis">
					<Highlight text={hit.snippet} query={query} />
				</span>
			</button>
			<DeleteChatButton
				workspaceId={hit.workspaceId}
				sessionId={hit.sessionId}
				isSelected={isSelected}
				onDeleteChat={onDeleteChat}
			/>
		</div>
	);
}

function PromptPreviewFooter({
	hit,
	workspaceName,
}: {
	hit: PromptHit;
	workspaceName: string | undefined;
}) {
	const parts = [
		hit.sessionTitle,
		hit.workspaceId ? (workspaceName ?? "workspace") : undefined,
		relativeTime(hit.timestamp),
	].filter((part): part is string => !!part);
	return <>{parts.join(" · ")}</>;
}

function HistoryPreview({
	item,
	query,
	workspaceName,
	className,
}: {
	item: HistorySelection | null;
	query: string;
	workspaceName: string | undefined;
	className: string;
}) {
	return (
		<div data-testid="history-preview" className={`flex flex-col overflow-hidden ${className}`}>
			{item ? (
				<>
					<div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-8 tr-text-ui text-text-default">
						<Highlight text={item.hit.text} query={query} />
					</div>
					<div className="shrink-0 border-t border-border-default px-8 py-4 text-text-muted tr-text-metadata">
						{item.kind === "prompt" ? (
							<PromptPreviewFooter hit={item.hit} workspaceName={workspaceName} />
						) : (
							messageCrumb(item.hit)
						)}
					</div>
				</>
			) : null}
		</div>
	);
}

function messageCrumb(hit: MessageHit): string {
	return `${hit.sessionTitle || hit.cwd.split("/").pop() || "session"} · ${hit.role} · ${relativeTime(hit.timestamp)}`;
}

export interface HistoryOverlayProps {
	state: HistorySearchState;
	workspaceNames: Record<string, string>;
	onQueryChange: (query: string) => void;
	onToggleStage: () => void;
	onMoveSelection: (delta: number) => void;
	onClose: () => void;
	onInsert: (hit: PromptHit) => void;
	onInsertAndSend: (hit: PromptHit) => void;
	onOpenMessage: (target: ChatLocationRequest) => void;
	onSaveAsTemplate: (hit: PromptHit) => void;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
	onSetScope: (kind: HistoryScope["kind"]) => void;
}

export function HistoryOverlay({
	state,
	workspaceNames,
	onQueryChange,
	onToggleStage,
	onMoveSelection,
	onClose,
	onInsert,
	onInsertAndSend,
	onOpenMessage,
	onSaveAsTemplate,
	onDeleteChat,
	onSetScope,
}: HistoryOverlayProps) {
	const { open, stage, query, scope, result, selected, error } = state;
	const inputRef = useRef<HTMLInputElement>(null);
	const resultsRef = useRef<HTMLDivElement>(null);
	const [scopeMenuOpen, setScopeMenuOpen] = useState(false);

	useEffect(() => {
		if (!open) return;
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.select();
	}, [open]);

	useEffect(() => {
		if (!open || scopeMenuOpen) return;
		const onWindowKeyDown = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onWindowKeyDown, true);
		return () => window.removeEventListener("keydown", onWindowKeyDown, true);
	}, [open, scopeMenuOpen, onClose]);

	const selectedKey = useMemo(() => {
		const sel = resolveHistorySelection(stage, result, selected);
		if (!sel) return null;
		return sel.kind === "prompt"
			? `p:${sel.hit.sessionId}:${sel.hit.messageIndex ?? sel.hit.timestamp}`
			: `m:${sel.hit.sessionId}:${sel.hit.messageIndex}`;
	}, [stage, result, selected]);

	useEffect(() => {
		if (selectedKey === null) return;
		resultsRef.current
			?.querySelector('[data-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [selectedKey]);

	if (!open) return null;

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) return;
		if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
			e.preventDefault();
			const item = resolveHistorySelection(stage, result, selected);
			if (item?.kind === "prompt") onSaveAsTemplate(item.hit);
			return;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			onMoveSelection(1);
			return;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			onMoveSelection(-1);
			return;
		}
		if (e.key === "Tab") {
			e.preventDefault();
			onToggleStage();
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			const item = resolveHistorySelection(stage, result, selected);
			if (!item) return;
			if (item.kind === "prompt" && !e.shiftKey) {
				if (e.metaKey || e.ctrlKey) onInsertAndSend(item.hit);
				else onInsert(item.hit);
				return;
			}
			const target = jumpTarget(item.hit);
			if (target) onOpenMessage(target);
		}
	};

	const promptCount = result ? Math.min(result.prompts.length, result.promptTotal) : 0;
	const messageCount = result ? Math.min(result.messages.length, result.messageTotal) : 0;
	const hasResults =
		!!result && (result.prompts.length > 0 || (stage === "zoomed" && result.messages.length > 0));
	const isEmpty = !!result && !result.indexing && !hasResults;

	const selectedItem = resolveHistorySelection(stage, result, selected);
	const selectedWorkspaceName = selectedItem?.hit.workspaceId
		? workspaceNames[selectedItem.hit.workspaceId]
		: undefined;

	const resultsBody = error ? (
		<div data-testid="history-error" className="p-12 text-center text-feedback-error tr-text-ui">
			search unavailable
		</div>
	) : !result ? null : (
		<>
			{result.indexing ? (
				<div
					data-testid="history-indexing"
					className="px-8 py-4 text-center text-text-muted tr-text-metadata"
				>
					indexing history…
				</div>
			) : null}
			{hasResults ? (
				<div className="flex flex-col gap-4 p-4">
					{result.prompts.length > 0 ? (
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between px-8 py-2 tr-text-eyebrow text-text-muted">
								<span>Prompts</span>
								<span data-testid="history-counts">
									{promptCount}/{result.promptTotal}
								</span>
							</div>
							{result.prompts.map((hit, i) => (
								<PromptRow
									key={`${hit.sessionId}:${hit.timestamp}`}
									hit={hit}
									query={query}
									scope={scope}
									workspaceName={hit.workspaceId ? workspaceNames[hit.workspaceId] : undefined}
									isSelected={i === selected}
									onPick={() => onInsert(hit)}
									onSaveAsTemplate={() => onSaveAsTemplate(hit)}
									onOpenMessage={onOpenMessage}
									onDeleteChat={onDeleteChat}
								/>
							))}
						</div>
					) : null}
					{stage === "zoomed" && result.messages.length > 0 ? (
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between px-8 py-2 tr-text-eyebrow text-text-muted">
								<span>Messages</span>
								<span data-testid="history-counts">
									{messageCount}/{result.messageTotal}
								</span>
							</div>
							{result.messages.map((hit, i) => (
								<MessageRow
									key={`${hit.sessionId}:${hit.messageIndex}`}
									hit={hit}
									query={query}
									isSelected={result.prompts.length + i === selected}
									onPick={() => {
										const target = jumpTarget(hit);
										if (target) onOpenMessage(target);
									}}
									onDeleteChat={onDeleteChat}
								/>
							))}
						</div>
					) : null}
				</div>
			) : isEmpty ? (
				<div className="p-12 text-center text-text-muted tr-text-ui">no matches</div>
			) : null}
		</>
	);

	return (
		<div
			data-testid="history-overlay"
			data-stage={stage}
			className="absolute bottom-full left-8 right-8 mb-4 flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg shadow-[var(--shadow-md)]"
		>
			<div className="flex items-center gap-8 border-b border-border-default p-8">
				<input
					ref={inputRef}
					data-testid="history-query"
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder="Search prompts and conversations…"
					className="min-w-0 flex-1 bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
				/>
				<DropdownMenu open={scopeMenuOpen} onOpenChange={setScopeMenuOpen}>
					<DropdownMenuTrigger
						data-testid="history-scope"
						data-scope={scope.kind}
						className="flex shrink-0 items-center gap-4 rounded-full border border-border-default bg-container-workspace-bg px-8 py-2 text-text-muted tr-text-metadata outline-none hover:bg-control-bg-hovered"
					>
						<span>{SCOPE_LABELS[scope.kind]}</span>
						<span className="text-text-muted">⌃R</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						onCloseAutoFocus={(e) => {
							e.preventDefault();
							inputRef.current?.focus();
						}}
					>
						{SCOPE_ORDER.map((kind) => (
							<DropdownMenuItem
								key={kind}
								data-testid="history-scope-option"
								data-scope={kind}
								onSelect={() => onSetScope(kind)}
							>
								<Check className={kind === scope.kind ? "size-14" : "size-14 invisible"} />
								<span>{SCOPE_MENU_LABELS[kind]}</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{stage === "zoomed" ? (
				<div className="flex flex-col overflow-hidden md:flex-row">
					<div
						ref={resultsRef}
						data-testid="history-results"
						className="max-h-[37.5vh] overflow-y-auto md:max-h-[75vh] md:w-[55%]"
					>
						{resultsBody}
					</div>
					<HistoryPreview
						item={selectedItem}
						query={query}
						workspaceName={selectedWorkspaceName}
						className="max-h-[37.5vh] border-border-default border-t md:max-h-[75vh] md:w-[45%] md:border-t-0 md:border-l"
					/>
				</div>
			) : (
				<div
					ref={resultsRef}
					data-testid="history-results"
					className="max-h-[40vh] overflow-y-auto"
				>
					{resultsBody}
				</div>
			)}
			{stage === "compact" && !error && result && !result.indexing && result.messageTotal > 0 ? (
				<button
					type="button"
					data-testid="history-expand-hint"
					onClick={onToggleStage}
					className="border-t border-border-default p-4 text-center text-text-muted tr-text-metadata hover:bg-control-bg-hovered"
				>
					{result.messageTotal} matches in conversations · ⇥ expand
				</button>
			) : null}
		</div>
	);
}
