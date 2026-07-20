import type { HistoryScope, MessageHit, PromptHit } from "@thinkrail/contracts";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { type HistorySearchState, resolveHistorySelection } from "./useHistorySearch";

const SCOPE_LABELS: Record<HistoryScope["kind"], string> = {
	chat: "Chat",
	workspace: "Workspace",
	project: "Project",
	all: "All",
};

/** Tiny relative-time formatter — `panels/CenterTabs.tsx` has a private twin; `chat/` can't import from
 * `panels/` (wrong dependency direction), and this is too small to promote to a shared lib. */
function relativeTime(ms: number): string {
	const s = Math.floor((Date.now() - ms) / 1000);
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

function escapeRegExp(term: string): string {
	return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wraps every case-insensitive occurrence of a `query` term in `text`. Term split matches the server
 * matcher exactly (`query.toLowerCase().split(/\s+/)`, see `packages/server/src/history/historyIndex.ts`)
 * so highlighted spans always line up with why a row matched; terms sort longest-first so overlapping
 * terms prefer the longer alternative.
 */
function Highlight({ text, query }: { text: string; query: string }) {
	const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].sort(
		(a, b) => b.length - a.length,
	);
	if (terms.length === 0) return <>{text}</>;
	const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
	// Key on each part's own start offset in `text` (not the array index) — parts are consecutive,
	// non-overlapping substrings, so `start` alone would collide only for two same-offset zero-length
	// gaps either side of back-to-back matches; pairing it with the part's own text rules that out too.
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
					<mark key={key} className="rounded-[2px] bg-[var(--primary-20)] text-text">
						{part}
					</mark>
				) : (
					<span key={key}>{part}</span>
				),
			)}
		</>
	);
}

function PromptRow({
	hit,
	query,
	scope,
	workspaceName,
	isSelected,
	onPick,
}: {
	hit: PromptHit;
	query: string;
	scope: HistoryScope;
	workspaceName: string | undefined;
	isSelected: boolean;
	onPick: () => void;
}) {
	const firstLine = hit.text.split("\n")[0] ?? hit.text;
	const showChip = (scope.kind === "project" || scope.kind === "all") && !!hit.workspaceId;
	return (
		<button
			type="button"
			data-testid="history-item"
			data-kind="prompt"
			onClick={onPick}
			className={`flex w-full items-center gap-sm rounded-[var(--radius-sm)] border-l-2 px-sm py-xs text-left text-sm ${
				isSelected ? "border-l-primary bg-hover text-text" : "border-l-transparent text-muted"
			}`}
		>
			<span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis">
				<Highlight text={firstLine} query={query} />
			</span>
			{showChip ? (
				<span className="shrink-0 rounded-full border border-border2 bg-bg px-xs text-[10px] text-hint">
					{workspaceName ?? "workspace"}
				</span>
			) : null}
			<span className="shrink-0 text-hint text-xs">{relativeTime(hit.timestamp)}</span>
		</button>
	);
}

function MessageRow({
	hit,
	query,
	isSelected,
	onPick,
}: {
	hit: MessageHit;
	query: string;
	isSelected: boolean;
	onPick: () => void;
}) {
	const unmapped = !hit.workspaceId;
	return (
		<button
			type="button"
			data-testid="history-item"
			data-kind="message"
			onClick={onPick}
			disabled={unmapped}
			className={`flex w-full flex-col gap-0.5 rounded-[var(--radius-sm)] border-l-2 px-sm py-xs text-left text-sm disabled:cursor-default ${
				isSelected ? "border-l-primary bg-hover text-text" : "border-l-transparent text-muted"
			}`}
		>
			<span className="flex items-center gap-xs text-hint text-xs">
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
	);
}

export interface HistoryOverlayProps {
	state: HistorySearchState;
	/** `workspaceId → display name` for every known workspace, so the "project"/"all" scope's cross-
	 * workspace chip can show a human label without this presentational component touching the store. */
	workspaceNames: Record<string, string>;
	onQueryChange: (query: string) => void;
	onCycleScope: () => void;
	onToggleStage: () => void;
	onMoveSelection: (delta: number) => void;
	onClose: () => void;
	/** Enter on a prompt hit — replace the draft, focus, caret at end, close. */
	onInsert: (hit: PromptHit) => void;
	/** Cmd/Ctrl+Enter on a prompt hit — insert then submit via the composer's own submit path. */
	onInsertAndSend: (hit: PromptHit) => void;
	/** Enter on a mapped message hit — jump to it (`useHistorySearch`'s `openMessage`). Unmapped hits never
	 * reach here — both the `Enter` handler below and each `MessageRow`'s `onPick` gate on `hit.workspaceId`
	 * first. */
	onOpenMessage: (hit: MessageHit) => void;
}

/**
 * The Ctrl+R history-recall overlay (props-driven, no store/transport — `useHistorySearch` owns that
 * edge). Anchored above the composer exactly like its mention menu (`Composer.tsx:224-263`): `compact`
 * shows prompts only (~40vh); `Tab` zooms to ~75vh with both the Prompts and Messages sections.
 */
export function HistoryOverlay({
	state,
	workspaceNames,
	onQueryChange,
	onCycleScope,
	onToggleStage,
	onMoveSelection,
	onClose,
	onInsert,
	onInsertAndSend,
	onOpenMessage,
}: HistoryOverlayProps) {
	const { open, stage, query, scope, result, selected, error } = state;
	const inputRef = useRef<HTMLInputElement>(null);

	// Auto-focus with the seeded text selected, the instant the overlay opens — not on every keystroke.
	useEffect(() => {
		if (!open) return;
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.select();
	}, [open]);

	if (!open) return null;

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "r" && e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			onCycleScope();
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
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			const item = resolveHistorySelection(stage, result, selected);
			if (!item) return;
			if (item.kind === "prompt") {
				if (e.metaKey || e.ctrlKey) onInsertAndSend(item.hit);
				else onInsert(item.hit);
			} else if (item.hit.workspaceId) {
				onOpenMessage(item.hit);
			}
		}
	};

	const promptCount = result ? Math.min(result.prompts.length, result.promptTotal) : 0;
	const messageCount = result ? Math.min(result.messages.length, result.messageTotal) : 0;
	const isEmpty =
		!!result &&
		!result.indexing &&
		result.prompts.length === 0 &&
		(stage === "compact" || result.messages.length === 0);

	return (
		<div
			data-testid="history-overlay"
			data-stage={stage}
			className="absolute bottom-full left-sm right-sm mb-xs flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border2 bg-elevated shadow-[var(--shadow-md)]"
		>
			<div className="flex items-center gap-sm border-b border-border2 p-sm">
				<input
					ref={inputRef}
					data-testid="history-query"
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder="Search prompts and conversations…"
					className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-hint"
				/>
				<button
					type="button"
					data-testid="history-scope"
					data-scope={scope.kind}
					onClick={onCycleScope}
					className="flex shrink-0 items-center gap-xs rounded-full border border-border2 bg-bg px-sm py-0.5 text-[11px] text-muted hover:bg-hover"
				>
					<span>{SCOPE_LABELS[scope.kind]}</span>
					<span className="text-hint">⌃R</span>
				</button>
			</div>
			<div className={`overflow-y-auto ${stage === "zoomed" ? "max-h-[75vh]" : "max-h-[40vh]"}`}>
				{error ? (
					<div data-testid="history-error" className="p-md text-center text-red text-sm">
						search unavailable
					</div>
				) : !result ? null : result.indexing ? (
					<div data-testid="history-indexing" className="p-md text-center text-muted text-sm">
						indexing history…
					</div>
				) : isEmpty ? (
					<div className="p-md text-center text-muted text-sm">no matches</div>
				) : (
					<div className="flex flex-col gap-xs p-xs">
						{result.prompts.length > 0 ? (
							<div className="flex flex-col gap-0.5">
								<div className="flex items-center justify-between px-sm py-0.5 text-hint text-xs uppercase tracking-wide">
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
									/>
								))}
							</div>
						) : null}
						{stage === "zoomed" && result.messages.length > 0 ? (
							<div className="flex flex-col gap-0.5">
								<div className="flex items-center justify-between px-sm py-0.5 text-hint text-xs uppercase tracking-wide">
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
										onPick={() => hit.workspaceId && onOpenMessage(hit)}
									/>
								))}
							</div>
						) : null}
					</div>
				)}
			</div>
			{stage === "compact" && !error && result && !result.indexing && result.messageTotal > 0 ? (
				<button
					type="button"
					data-testid="history-expand-hint"
					onClick={onToggleStage}
					className="border-t border-border2 p-xs text-center text-hint text-xs hover:bg-hover"
				>
					{result.messageTotal} matches in conversations · ⇥ expand
				</button>
			) : null}
		</div>
	);
}
