import type { HistoryScope, MessageHit, PromptHit } from "@thinkrail/contracts";
import { Check, Save } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type HistorySearchState,
	type HistorySelection,
	resolveHistorySelection,
	SCOPE_ORDER,
} from "./useHistorySearch";

const SCOPE_LABELS: Record<HistoryScope["kind"], string> = {
	chat: "Chat",
	workspace: "Workspace",
	project: "Project",
	all: "All",
};

/** The scope picker's dropdown labels (R2) — fuller than the terse badge label above (a menu has room a
 * pill doesn't), matching the design doc's prose exactly: "This chat / Workspace / Project / Everywhere". */
const SCOPE_MENU_LABELS: Record<HistoryScope["kind"], string> = {
	chat: "This chat",
	workspace: "Workspace",
	project: "Project",
	all: "Everywhere",
};

/** Cmd on Mac/iOS, Ctrl elsewhere — matches the modifier `onKeyDown` below actually checks
 * (`e.metaKey || e.ctrlKey`), so the save-as-template button's tooltip never shows a glyph the user's
 * platform doesn't have. Guarded for a non-browser environment (e.g. this module under a non-DOM test
 * runner) — falls back to the cross-platform spelling. */
const SAVE_SHORTCUT_LABEL =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "")
		? "⌘S"
		: "Ctrl+S";

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
	onSaveAsTemplate,
}: {
	hit: PromptHit;
	query: string;
	scope: HistoryScope;
	workspaceName: string | undefined;
	isSelected: boolean;
	onPick: () => void;
	onSaveAsTemplate: () => void;
}) {
	const firstLine = hit.text.split("\n")[0] ?? hit.text;
	const showChip = (scope.kind === "project" || scope.kind === "all") && !!hit.workspaceId;
	return (
		<div
			data-testid="history-item"
			data-kind="prompt"
			data-selected={isSelected}
			className={`group flex w-full items-center gap-xs rounded-[var(--radius-sm)] border-l-2 py-xs pl-sm pr-xs text-left text-sm ${
				isSelected ? "border-l-primary bg-hover text-text" : "border-l-transparent text-muted"
			}`}
		>
			<button
				type="button"
				onClick={onPick}
				className="flex min-w-0 flex-1 items-center gap-sm overflow-hidden text-left"
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
			<button
				type="button"
				data-testid="history-save-template"
				aria-label="Save as template"
				title={`Save as template (${SAVE_SHORTCUT_LABEL})`}
				onClick={(e) => {
					e.stopPropagation();
					onSaveAsTemplate();
				}}
				className={`flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] p-xs text-muted opacity-0 transition hover:bg-elevated hover:text-text group-hover:opacity-100 ${
					isSelected ? "opacity-100" : ""
				}`}
			>
				<Save className="size-3.5" />
			</button>
		</div>
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
			data-selected={isSelected}
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

/** A prompt hit's preview footer: chat title (when set) / a workspace chip whenever the hit has a
 * `workspaceId` — unlike `PromptRow`'s chip, never scope-gated, since a single detail pane has room a
 * dense list row doesn't — / relative time, `·`-joined like every other crumb in this file. */
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

/**
 * The zoomed stage's right-hand pane (R1) — a full-text preview of the flat-list keyboard-selected item.
 * Always mounted while `stage === "zoomed"` (never in `compact`), so `data-testid="history-preview"`'s
 * mere presence in the DOM doubles as the zoomed/compact signal. `item` is `null` when there's nothing
 * selected (an empty result set) — renders an empty panel then, never a crash. Body reuses `Highlight`
 * **verbatim** (the same helper `PromptRow`/`MessageRow` use for their truncated text) over the hit's
 * full `text` — never a row's first-line/snippet truncation — so a long prompt's tail, cut off in the
 * list, reads in full here.
 */
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
					<div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-sm text-sm text-text">
						<Highlight text={item.hit.text} query={query} />
					</div>
					<div className="shrink-0 border-t border-border2 px-sm py-xs text-[11px] text-hint">
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

/** A message hit's preview footer — the literal `sessionTitle · role · relative time` crumb (R1 spec),
 * deliberately simpler than `MessageRow`'s own header (which also flags an unmapped session): the row
 * immediately to this preview's left already carries that flag, so the preview isn't the only place it
 * shows. */
function messageCrumb(hit: MessageHit): string {
	return `${hit.sessionTitle || hit.cwd.split("/").pop() || "session"} · ${hit.role} · ${relativeTime(hit.timestamp)}`;
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
	/** A prompt row's save-as-template action — its own button (hover-revealed, every row) and
	 * Cmd/Ctrl+S while that row is the keyboard selection. Opens `TemplateEditorDialog` body-prefilled;
	 * `ChatView` owns the dialog, this overlay only reports the hit. */
	onSaveAsTemplate: (hit: PromptHit) => void;
	/** R2's mouse path: a direct scope pick from the badge's dropdown menu. `onCycleScope` stays the
	 * `Ctrl+R` keyboard path, unaffected — both just set the same underlying scope state
	 * (`useHistorySearch.ts`'s `setScope`/`cycleScope` reset the results selection identically). */
	onSetScope: (kind: HistoryScope["kind"]) => void;
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
	onSaveAsTemplate,
	onSetScope,
}: HistoryOverlayProps) {
	const { open, stage, query, scope, result, selected, error } = state;
	const inputRef = useRef<HTMLInputElement>(null);
	const resultsRef = useRef<HTMLDivElement>(null);

	// Auto-focus with the seeded text selected, the instant the overlay opens — not on every keystroke.
	useEffect(() => {
		if (!open) return;
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.select();
	}, [open]);

	// Arrow-key navigation moves `selected` past the edge of what's currently scrolled into view — the
	// container itself scrolls (mouse wheel, drag), but a keyboard-only selection change never does on its
	// own. `block: "nearest"` is the minimal scroll: it only moves the container when the selected row is
	// actually outside the visible range, never re-centers a row that's already visible. `selected`/
	// `stage`/`result` are all trigger-only — the body reaches the selected row through the DOM (via
	// `data-selected`), not through these values directly — but a stage toggle or a fresh result can change
	// which row `selected`'s index now points at without the index itself changing, so all three must
	// re-run the effect.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selected/stage/result are re-render triggers, not body inputs — the row is found via the DOM, not these values
	useEffect(() => {
		resultsRef.current
			?.querySelector('[data-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [selected, stage, result]);

	if (!open) return null;

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "r" && e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			onCycleScope();
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
			// Always swallow — Cmd/Ctrl+S is the browser's own "save page" shortcut. Only a prompt row
			// selection actually opens the save-as-template dialog; on a message hit (or none) this is a
			// no-op, same as Enter's message-hit gating above.
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
	// A cold-build partial (`result.indexing`) can still carry real hits — whatever the server's budget
	// managed to parse before it gave up and returned early. `hasResults` is checked independently of
	// `indexing` so those partials render instead of being suppressed behind the indexing message; `isEmpty`
	// only ever fires once indexing is done, so a partial's "nothing found yet" moment never flashes "no
	// matches" while the index is still filling in.
	const hasResults =
		!!result && (result.prompts.length > 0 || (stage === "zoomed" && result.messages.length > 0));
	const isEmpty = !!result && !result.indexing && !hasResults;

	// The zoomed stage's preview (R1) mirrors whatever the flat-list `selected` index currently resolves
	// to — the same resolution `Enter`/Cmd/Ctrl+S already use above, so the preview and the keyboard
	// actions can never disagree on "the selected item." `null` (no result yet, or an empty result set)
	// renders an empty panel, never a crash — see `HistoryPreview`.
	const selectedItem = resolveHistorySelection(stage, result, selected);
	const selectedWorkspaceName = selectedItem?.hit.workspaceId
		? workspaceNames[selectedItem.hit.workspaceId]
		: undefined;

	const resultsBody = error ? (
		<div data-testid="history-error" className="p-md text-center text-red text-sm">
			search unavailable
		</div>
	) : !result ? null : (
		<>
			{result.indexing ? (
				<div
					data-testid="history-indexing"
					className="px-sm py-1 text-center text-hint text-[11px]"
				>
					indexing history…
				</div>
			) : null}
			{hasResults ? (
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
									onSaveAsTemplate={() => onSaveAsTemplate(hit)}
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
			) : isEmpty ? (
				<div className="p-md text-center text-muted text-sm">no matches</div>
			) : null}
		</>
	);

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
				<DropdownMenu>
					<DropdownMenuTrigger
						data-testid="history-scope"
						data-scope={scope.kind}
						className="flex shrink-0 items-center gap-xs rounded-full border border-border2 bg-bg px-sm py-0.5 text-[11px] text-muted outline-none hover:bg-hover"
					>
						<span>{SCOPE_LABELS[scope.kind]}</span>
						<span className="text-hint">⌃R</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						// Radix's default on close is to return focus to the trigger — override it so focus
						// lands back on the query input instead, the same place it is right after `Enter`
						// inserts a prompt. `Ctrl+R` cycling only fires from the input's own `onKeyDown`, so
						// this is also what keeps it working right after a mouse pick.
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
								<Check className={kind === scope.kind ? "size-3.5" : "size-3.5 invisible"} />
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
						className="max-h-[37.5vh] border-border2 border-t md:max-h-[75vh] md:w-[45%] md:border-t-0 md:border-l"
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
					className="border-t border-border2 p-xs text-center text-hint text-xs hover:bg-hover"
				>
					{result.messageTotal} matches in conversations · ⇥ expand
				</button>
			) : null}
		</div>
	);
}
