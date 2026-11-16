import {
	RiCheckLine as Check,
	RiCornerUpRightLine as CornerUpRight,
	RiSaveLine as Save,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { HistoryScope, MessageHit, PromptHit } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { isContextMenuKey } from "@thinkrail/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNow } from "@/components/useNow";
import { LOCAL_KEY_DEFAULTS } from "@/keybindings";
import { fileName, firstNonBlankLine, relativeTime } from "@/lib";
import {
	type ChatLocationRequest,
	type HistorySearchState,
	type HistorySelection,
	jumpTarget,
	resolveHistorySelection,
	SCOPE_ORDER,
} from "./useHistorySearch";

const SCOPE_LABELS = {
	chat: "chat.history.scope.chat",
	workspace: "chat.history.scope.workspace",
	project: "chat.history.scope.project",
	all: "chat.history.scope.all",
} satisfies Record<HistoryScope["kind"], MessageKey>;

const SCOPE_MENU_LABELS = {
	chat: "chat.history.scopeMenu.chat",
	workspace: "chat.history.scopeMenu.workspace",
	project: "chat.history.scopeMenu.project",
	all: "chat.history.scopeMenu.all",
} satisfies Record<HistoryScope["kind"], MessageKey>;

function escapeRegExp(term: string): string {
	return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type HighlightTerms = { terms: Set<string>; pattern: RegExp } | null;

function highlightTerms(query: string): HighlightTerms {
	const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].sort(
		(a, b) => b.length - a.length,
	);
	if (terms.length === 0) return null;
	return {
		terms: new Set(terms),
		pattern: new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi"),
	};
}

function Highlight({ text, highlight }: { text: string; highlight: HighlightTerms }) {
	if (!highlight) return <>{text}</>;
	const { terms, pattern } = highlight;
	let offset = 0;
	const parts = text.split(pattern).map((part) => {
		const start = offset;
		offset += part.length;
		return { text: part, key: `${start}:${part}` };
	});
	return (
		<>
			{parts.map(({ text: part, key }) =>
				terms.has(part.toLowerCase()) ? (
					<mark key={key} className="rounded-xs bg-primary-soft text-text-default">
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
	canDeleteChat,
}: {
	workspaceId: string | undefined;
	sessionId: string;
	isSelected: boolean;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
	canDeleteChat: (workspaceId: string) => boolean;
}) {
	const t = useT();
	if (!workspaceId || !canDeleteChat(workspaceId)) return null;
	return (
		<IconTooltip label={t("chat.history.deleteChat")}>
			<button
				type="button"
				data-testid="history-delete-chat"
				aria-label={t("chat.history.deleteChat")}
				onClick={(event) => {
					event.stopPropagation();
					onDeleteChat(workspaceId, sessionId);
				}}
				className={`flex shrink-0 items-center justify-center rounded-sm p-4 text-text-muted opacity-0 transition hover:bg-container-elevated-bg hover:text-feedback-error group-hover:opacity-100 ${
					isSelected ? "opacity-100" : ""
				}`}
			>
				<Trash2 className="size-14" />
			</button>
		</IconTooltip>
	);
}

type DeletableChat = { workspaceId: string; sessionId: string };

function HistoryEntryMenu({
	item,
	deletable,
	onClose,
	onOpenMessage,
	onSaveAsTemplate,
	onDeleteChat,
	onRestoreFocus,
}: {
	item: HistorySelection;
	deletable: DeletableChat | null;
	onClose: () => void;
	onOpenMessage: (target: ChatLocationRequest) => void;
	onSaveAsTemplate: (hit: PromptHit) => void;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
	onRestoreFocus: () => void;
}) {
	const t = useT();
	const target = jumpTarget(item.hit);
	return (
		<DropdownMenu
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DropdownMenuTrigger asChild>
				<span aria-hidden className="pointer-events-none absolute bottom-0 left-8 h-0 w-0" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				data-testid="history-entry-menu"
				aria-label={t("chat.history.entryMenu")}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					onRestoreFocus();
				}}
			>
				{target ? (
					<DropdownMenuItem data-testid="history-entry-jump" onSelect={() => onOpenMessage(target)}>
						{t("chat.history.jump")}
					</DropdownMenuItem>
				) : null}
				{item.kind === "prompt" ? (
					<DropdownMenuItem
						data-testid="history-entry-save-template"
						onSelect={() => onSaveAsTemplate(item.hit)}
					>
						{t("chat.history.saveTemplate")}
					</DropdownMenuItem>
				) : null}
				{deletable ? (
					<DropdownMenuItem
						data-testid="history-entry-delete"
						onSelect={() => onDeleteChat(deletable.workspaceId, deletable.sessionId)}
					>
						{t("chat.history.deleteChat")}
					</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function PromptRow({
	hit,
	highlight,
	scope,
	workspaceName,
	isSelected,
	saveShortcut,
	onPick,
	onSaveAsTemplate,
	onOpenMessage,
	onDeleteChat,
	canDeleteChat,
	entryMenu,
}: {
	hit: PromptHit;
	highlight: HighlightTerms;
	scope: HistoryScope;
	workspaceName: string | undefined;
	isSelected: boolean;
	saveShortcut: string;
	onPick: () => void;
	onSaveAsTemplate: () => void;
	onOpenMessage: (target: ChatLocationRequest) => void;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
	canDeleteChat: (workspaceId: string) => boolean;
	entryMenu: ReactNode;
}) {
	const t = useT();
	const now = useNow();
	const firstLine = firstNonBlankLine(hit.text) ?? "";
	const showChip = (scope.kind === "project" || scope.kind === "all") && !!hit.workspaceId;
	const target = jumpTarget(hit);
	return (
		<div
			data-testid="history-item"
			data-kind="prompt"
			data-row={isSelected || undefined}
			data-selected={isSelected}
			className={`group relative flex w-full items-center gap-4 rounded-sm border-l-2 py-4 pl-8 pr-4 text-left tr-text-ui ${
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
					<Highlight text={firstLine} highlight={highlight} />
				</span>
				{showChip ? (
					<span className="shrink-0 rounded-full border border-border-default bg-container-workspace-bg px-4 text-text-muted tr-text-metadata">
						{workspaceName ?? t("chat.history.workspaceFallback")}
					</span>
				) : null}
				<span className="shrink-0 text-text-muted tr-text-metadata">
					{relativeTime(t, hit.timestamp, now)}
				</span>
			</button>
			{isSelected && saveShortcut !== "" ? (
				<span
					data-testid="history-save-shortcut"
					className="shrink-0 text-text-muted tr-text-metadata"
				>
					{saveShortcut}
				</span>
			) : null}
			<IconButton
				icon={Save}
				size="s"
				data-testid="history-save-template"
				label={t("chat.history.saveTemplate")}
				tooltip={
					saveShortcut === ""
						? t("chat.history.saveTemplate")
						: t("chat.history.saveTemplateTooltip", { shortcut: saveShortcut })
				}
				onClick={(e) => {
					e.stopPropagation();
					onSaveAsTemplate();
				}}
				className={`shrink-0 opacity-0 group-hover:opacity-100 ${isSelected ? "opacity-100" : ""}`}
			/>
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
					<IconButton
						icon={CornerUpRight}
						size="s"
						data-testid="history-jump"
						label={t("chat.history.jump")}
						tooltip={t("chat.history.jumpTooltip", { shortcut: "⇧⏎" })}
						onClick={(e) => {
							e.stopPropagation();
							onOpenMessage(target);
						}}
						className={`shrink-0 opacity-0 group-hover:opacity-100 ${isSelected ? "opacity-100" : ""}`}
					/>
				</>
			) : null}
			<DeleteChatButton
				workspaceId={hit.workspaceId}
				sessionId={hit.sessionId}
				isSelected={isSelected}
				onDeleteChat={onDeleteChat}
				canDeleteChat={canDeleteChat}
			/>
			{entryMenu}
		</div>
	);
}

function MessageRow({
	hit,
	highlight,
	isSelected,
	onPick,
	onDeleteChat,
	canDeleteChat,
	entryMenu,
}: {
	hit: MessageHit;
	highlight: HighlightTerms;
	isSelected: boolean;
	onPick: () => void;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
	canDeleteChat: (workspaceId: string) => boolean;
	entryMenu: ReactNode;
}) {
	const t = useT();
	const now = useNow();
	const unmapped = !hit.workspaceId;
	return (
		<div
			data-testid="history-item"
			data-kind="message"
			data-row={isSelected || undefined}
			data-selected={isSelected}
			className={`group relative flex w-full items-center gap-4 rounded-sm border-l-2 pr-4 tr-text-ui ${
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
						{hit.sessionTitle || fileName(hit.cwd) || t("chat.history.sessionFallback")}
					</span>
					<span>·</span>
					<span>{t(HISTORY_ROLE_LABEL[hit.role])}</span>
					<span>·</span>
					<span>{relativeTime(t, hit.timestamp, now)}</span>
					{unmapped ? <span>{t("chat.history.unmapped")}</span> : null}
				</span>
				<span className="overflow-hidden whitespace-nowrap text-ellipsis">
					<Highlight text={hit.snippet} highlight={highlight} />
				</span>
			</button>
			<DeleteChatButton
				workspaceId={hit.workspaceId}
				sessionId={hit.sessionId}
				isSelected={isSelected}
				onDeleteChat={onDeleteChat}
				canDeleteChat={canDeleteChat}
			/>
			{entryMenu}
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
	const t = useT();
	const now = useNow();
	const parts = [
		hit.sessionTitle,
		hit.workspaceId ? (workspaceName ?? t("chat.history.workspaceFallback")) : undefined,
		relativeTime(t, hit.timestamp, now),
	].filter((part): part is string => !!part);
	return <>{parts.join(" · ")}</>;
}

function HistoryPreview({
	item,
	highlight,
	workspaceName,
	className,
}: {
	item: HistorySelection | null;
	highlight: HighlightTerms;
	workspaceName: string | undefined;
	className: string;
}) {
	const t = useT();
	const now = useNow();
	return (
		<div data-testid="history-preview" className={`flex flex-col overflow-hidden ${className}`}>
			{item ? (
				<>
					<div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-8 tr-text-ui text-text-default">
						<Highlight text={item.hit.text} highlight={highlight} />
					</div>
					<div className="shrink-0 border-t border-border-default px-8 py-4 text-text-muted tr-text-metadata">
						{item.kind === "prompt" ? (
							<PromptPreviewFooter hit={item.hit} workspaceName={workspaceName} />
						) : (
							messageCrumb(t, item.hit, now)
						)}
					</div>
				</>
			) : null}
		</div>
	);
}

const HISTORY_ROLE_LABEL = {
	user: "chat.history.role.user",
	assistant: "chat.history.role.assistant",
} as const satisfies Record<MessageHit["role"], MessageKey>;

function messageCrumb(t: Translator, hit: MessageHit, now: number): string {
	return `${hit.sessionTitle || fileName(hit.cwd) || t("chat.history.sessionFallback")} · ${t(HISTORY_ROLE_LABEL[hit.role])} · ${relativeTime(t, hit.timestamp, now)}`;
}

export interface HistoryOverlayProps {
	state: HistorySearchState;
	workspaceNames: Record<string, string>;
	onQueryChange: (query: string) => void;
	onToggleStage: () => void;
	onMoveSelection: (delta: number) => void;
	onClose: () => void;
	onOutsidePress: () => void;
	onInsert: (hit: PromptHit) => void;
	onInsertAndSend: (hit: PromptHit) => void;
	onOpenMessage: (target: ChatLocationRequest) => void;
	onSaveAsTemplate: (hit: PromptHit) => void;
	onDeleteChat: (workspaceId: string, sessionId: string) => void;
	canDeleteChat: (workspaceId: string) => boolean;
	onSetScope: (kind: HistoryScope["kind"]) => void;
}

export function HistoryOverlay(props: HistoryOverlayProps) {
	return props.state.open ? <HistoryPicker {...props} /> : null;
}

function HistoryPicker({
	state,
	workspaceNames,
	onQueryChange,
	onToggleStage,
	onMoveSelection,
	onClose,
	onOutsidePress,
	onInsert,
	onInsertAndSend,
	onOpenMessage,
	onSaveAsTemplate,
	onDeleteChat,
	canDeleteChat,
	onSetScope,
}: HistoryOverlayProps) {
	const t = useT();
	const keys = useLocalKeys("history", LOCAL_KEY_DEFAULTS.history);
	const saveShortcut = keys.label("history.saveTemplate");
	const { stage, query, scope, result, selected, error } = state;
	const inputRef = useRef<HTMLInputElement>(null);
	const resultsRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
	const [entryMenuKey, setEntryMenuKey] = useState<string | null>(null);
	const highlight = useMemo(() => highlightTerms(query), [query]);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.select();
	}, []);

	const selectedKey = useMemo(() => {
		const sel = resolveHistorySelection(stage, result, selected);
		if (!sel) return null;
		return sel.kind === "prompt"
			? `p:${sel.hit.sessionId}:${sel.hit.messageIndex ?? sel.hit.timestamp}`
			: `m:${sel.hit.sessionId}:${sel.hit.messageIndex}`;
	}, [stage, result, selected]);
	const entryMenuOpen = entryMenuKey !== null && entryMenuKey === selectedKey;
	const layerOpen = scopeMenuOpen || entryMenuOpen;

	useEffect(() => {
		if (layerOpen) return;
		const onWindowKeyDown = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape" || isImeComposing(e) || keys.match(e) !== null) return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onWindowKeyDown, true);
		return () => window.removeEventListener("keydown", onWindowKeyDown, true);
	}, [layerOpen, onClose, keys]);

	useEffect(() => {
		if (layerOpen) return;
		const onWindowPointerDown = (e: PointerEvent) => {
			const target = e.target as Element | null;
			if (!target) return;
			if (rootRef.current?.contains(target)) return;
			if (target.closest("[data-history-trigger]")) return;
			onOutsidePress();
		};
		window.addEventListener("pointerdown", onWindowPointerDown, true);
		return () => window.removeEventListener("pointerdown", onWindowPointerDown, true);
	}, [layerOpen, onOutsidePress]);

	useEffect(() => {
		if (selectedKey === null) return;
		resultsRef.current
			?.querySelector('[data-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [selectedKey]);

	const deletableChat = (item: HistorySelection | null): DeletableChat | null => {
		const workspaceId = item?.hit.workspaceId;
		return item && workspaceId && canDeleteChat(workspaceId)
			? { workspaceId, sessionId: item.hit.sessionId }
			: null;
	};
	const hasEntryActions = (item: HistorySelection | null) =>
		!!item && (item.kind === "prompt" || !!jumpTarget(item.hit) || !!deletableChat(item));

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (isImeComposing(e.nativeEvent)) return;
		if (isContextMenuKey(e) && !e.altKey && !e.ctrlKey && !e.metaKey) {
			if (
				selectedKey === null ||
				!hasEntryActions(resolveHistorySelection(stage, result, selected))
			)
				return;
			e.preventDefault();
			setEntryMenuKey(selectedKey);
			return;
		}
		const { selectionStart, selectionEnd } = e.currentTarget;
		const editsQuery =
			e.key.length === 1 ||
			e.key === "Backspace" ||
			selectionStart !== query.length ||
			selectionEnd !== query.length;
		const local = keys.match(e.nativeEvent, { textEntry: editsQuery });
		if (local === "history.deleteChat") {
			const chat = deletableChat(resolveHistorySelection(stage, result, selected));
			if (!chat) return;
			e.preventDefault();
			onDeleteChat(chat.workspaceId, chat.sessionId);
			return;
		}
		if (local === "history.saveTemplate") {
			e.preventDefault();
			const item = resolveHistorySelection(stage, result, selected);
			if (item?.kind === "prompt") onSaveAsTemplate(item.hit);
			return;
		}
		if (local === "history.send") {
			e.preventDefault();
			const item = resolveHistorySelection(stage, result, selected);
			const target = item && item.kind !== "prompt" ? jumpTarget(item.hit) : null;
			if (item?.kind === "prompt") onInsertAndSend(item.hit);
			else if (target) onOpenMessage(target);
			return;
		}
		if (local !== null || e.altKey || e.ctrlKey || e.metaKey) return;
		if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.shiftKey) {
			e.preventDefault();
			onMoveSelection(e.key === "ArrowDown" ? 1 : -1);
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
				onInsert(item.hit);
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
	const entryMenu =
		entryMenuOpen && selectedItem ? (
			<HistoryEntryMenu
				item={selectedItem}
				deletable={deletableChat(selectedItem)}
				onClose={() => setEntryMenuKey(null)}
				onOpenMessage={onOpenMessage}
				onSaveAsTemplate={onSaveAsTemplate}
				onDeleteChat={onDeleteChat}
				onRestoreFocus={() => inputRef.current?.focus()}
			/>
		) : null;
	const selectedWorkspaceName = selectedItem?.hit.workspaceId
		? workspaceNames[selectedItem.hit.workspaceId]
		: undefined;

	const resultsBody = error ? (
		<div data-testid="history-error" className="p-12 text-center text-feedback-error tr-text-ui">
			{t("chat.history.error")}
		</div>
	) : !result ? null : (
		<>
			{result.indexing ? (
				<div
					data-testid="history-indexing"
					className="px-8 py-4 text-center text-text-muted tr-text-metadata"
				>
					{t("chat.history.indexing")}
				</div>
			) : null}
			{hasResults ? (
				<div className="flex flex-col gap-4 p-4">
					{result.prompts.length > 0 ? (
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between px-8 py-2 tr-text-eyebrow text-text-muted">
								<span>{t("chat.history.prompts")}</span>
								<span data-testid="history-counts">
									{promptCount}/{result.promptTotal}
								</span>
							</div>
							{result.prompts.map((hit, i) => (
								<PromptRow
									key={`${hit.sessionId}:${hit.timestamp}`}
									hit={hit}
									highlight={highlight}
									scope={scope}
									workspaceName={hit.workspaceId ? workspaceNames[hit.workspaceId] : undefined}
									isSelected={i === selected}
									saveShortcut={saveShortcut}
									onPick={() => onInsert(hit)}
									onSaveAsTemplate={() => onSaveAsTemplate(hit)}
									onOpenMessage={onOpenMessage}
									onDeleteChat={onDeleteChat}
									canDeleteChat={canDeleteChat}
									entryMenu={i === selected ? entryMenu : null}
								/>
							))}
						</div>
					) : null}
					{stage === "zoomed" && result.messages.length > 0 ? (
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between px-8 py-2 tr-text-eyebrow text-text-muted">
								<span>{t("chat.history.messages")}</span>
								<span data-testid="history-counts">
									{messageCount}/{result.messageTotal}
								</span>
							</div>
							{result.messages.map((hit, i) => (
								<MessageRow
									key={`${hit.sessionId}:${hit.messageIndex}`}
									hit={hit}
									highlight={highlight}
									isSelected={result.prompts.length + i === selected}
									onPick={() => {
										const target = jumpTarget(hit);
										if (target) onOpenMessage(target);
									}}
									onDeleteChat={onDeleteChat}
									canDeleteChat={canDeleteChat}
									entryMenu={result.prompts.length + i === selected ? entryMenu : null}
								/>
							))}
						</div>
					) : null}
				</div>
			) : isEmpty ? (
				<div className="p-12 text-center text-text-muted tr-text-ui">
					{t("chat.history.noMatches")}
				</div>
			) : null}
		</>
	);

	return (
		<div
			ref={rootRef}
			data-testid="history-overlay"
			data-stage={stage}
			className="absolute bottom-full left-8 right-8 z-20 mb-4 flex flex-col overflow-hidden rounded-lg border border-border-default bg-container-elevated-bg shadow-[var(--shadow-md)]"
		>
			<div className="flex items-center gap-8 border-b border-border-default p-8">
				<input
					ref={inputRef}
					data-testid="history-query"
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder={t("chat.history.placeholder")}
					className="min-w-0 flex-1 bg-transparent tr-text-ui text-text-default focus-visible:focus-ring placeholder:text-text-muted"
				/>
				<DropdownMenu open={scopeMenuOpen} onOpenChange={setScopeMenuOpen}>
					<DropdownMenuTrigger
						data-testid="history-scope"
						data-scope={scope.kind}
						className="flex shrink-0 items-center gap-4 rounded-full border border-border-default bg-container-workspace-bg px-8 py-2 text-text-muted tr-text-metadata hover:bg-control-bg-hovered focus-visible:focus-ring"
					>
						<span>{t(SCOPE_LABELS[scope.kind])}</span>
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
								<span>{t(SCOPE_MENU_LABELS[kind])}</span>
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
						highlight={highlight}
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
					{t("chat.history.expandHint", { count: result.messageTotal })}
				</button>
			) : null}
		</div>
	);
}
