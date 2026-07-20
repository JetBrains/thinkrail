import type {
	HistoryScope,
	HistorySearchResult,
	MessageHit,
	PromptHit,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

/** `compact` shows prompts only (a few rows); `Tab` zooms to both sections. */
export type HistoryStage = "compact" | "zoomed";

/** The Ctrl+R history-recall overlay's full state — owned by `useHistorySearch`, rendered by the
 * presentational `HistoryOverlay`. */
export interface HistorySearchState {
	open: boolean;
	stage: HistoryStage;
	query: string;
	scope: HistoryScope;
	result: HistorySearchResult | null;
	selected: number;
	error: boolean;
}

/** One flat-list selection: a prompt hit (insertable) or a message hit (a jump target — see `openMessage`). */
export type HistorySelection =
	| { kind: "prompt"; hit: PromptHit }
	| { kind: "message"; hit: MessageHit };

const SCOPE_ORDER = ["chat", "workspace", "project", "all"] as const;
type ScopeKind = (typeof SCOPE_ORDER)[number];

function buildScope(
	kind: ScopeKind,
	sessionId: string,
	workspaceId: string,
	projectId: string | undefined,
): HistoryScope {
	switch (kind) {
		case "chat":
			return { kind: "chat", sessionId };
		case "workspace":
			return { kind: "workspace", workspaceId };
		case "project":
			// An unresolved owning project (store not hydrated yet) falls back to an id that can never
			// match — the host's `buildHistoryScope` treats an unknown project id as "no results," never a
			// throw — rather than sending a scope shape the caller can't actually have intended.
			return { kind: "project", projectId: projectId ?? "" };
		case "all":
			return { kind: "all" };
	}
}

/** How many items the current stage exposes as a flat, arrow-key-navigable list — prompts only in
 * `compact`; prompts then messages in `zoomed` (same order `resolveHistorySelection` resolves against). */
function flatListLength(stage: HistoryStage, result: HistorySearchResult | null): number {
	if (!result) return 0;
	return stage === "compact"
		? result.prompts.length
		: result.prompts.length + result.messages.length;
}

/**
 * Pure resolution of the flat-list `selected` index into the hit it points at (or `null` when the index
 * is out of range for the current stage — e.g. the instant `Tab` collapses `zoomed` back to `compact` and
 * the selection had been sitting in the messages section). Exported so the presentational
 * `HistoryOverlay` can resolve the same index for row highlighting and `Enter` handling without
 * duplicating the prompts-then-messages ordering rule.
 */
export function resolveHistorySelection(
	stage: HistoryStage,
	result: HistorySearchResult | null,
	selected: number,
): HistorySelection | null {
	if (!result) return null;
	if (selected < result.prompts.length) {
		const hit = result.prompts[selected];
		return hit ? { kind: "prompt", hit } : null;
	}
	if (stage !== "zoomed") return null;
	const hit = result.messages[selected - result.prompts.length];
	return hit ? { kind: "message", hit } : null;
}

/**
 * The Ctrl+R history-recall overlay's integration edge — the one hook (besides `ChatView` itself)
 * sanctioned to touch store/transport (see `chat/SPEC.md`'s boundary section). Owns the overlay's
 * open/stage/query/scope/selection state, debounces `history.search` 100ms per query/scope change, and
 * drops stale responses via a sequence token so a slow earlier request can never clobber a faster later
 * one.
 */
export function useHistorySearch(
	sessionId: string,
	workspaceId: string,
	projectId: string | undefined,
): {
	state: HistorySearchState;
	openOverlay: (seedQuery: string) => void;
	close: () => void;
	setQuery: (q: string) => void;
	cycleScope: () => void;
	toggleStage: () => void;
	moveSelection: (delta: number) => void;
	selectedItem: () => HistorySelection | null;
	openMessage: (hit: MessageHit) => void;
} {
	const [open, setOpen] = useState(false);
	const [stage, setStage] = useState<HistoryStage>("compact");
	const [query, setQueryState] = useState("");
	const [scopeKind, setScopeKind] = useState<ScopeKind>("workspace");
	const [result, setResult] = useState<HistorySearchResult | null>(null);
	const [selected, setSelected] = useState(0);
	const [error, setError] = useState(false);

	const scope = useMemo(
		() => buildScope(scopeKind, sessionId, workspaceId, projectId),
		[scopeKind, sessionId, workspaceId, projectId],
	);

	// Debounce 100ms per query/scope change; a sequence token drops stale responses (a slow earlier
	// request resolving after a faster later one must never overwrite it). The token bumps unconditionally
	// (even while closed) so a response in flight at close time can never land after reopening.
	const tokenRef = useRef(0);
	useEffect(() => {
		const token = ++tokenRef.current;
		if (!open) return;
		const timer = setTimeout(() => {
			getTransport()
				.request("history.search", { query, scope, limit: 50 })
				.then((res) => {
					if (tokenRef.current !== token) return;
					setResult(res);
					setError(false);
				})
				.catch(() => {
					if (tokenRef.current !== token) return;
					setError(true);
				});
		}, 100);
		return () => clearTimeout(timer);
	}, [open, query, scope]);

	// Keep `selected` in range as the visible flat list changes shape (a narrower result set, or a stage
	// toggle that changes which sections are visible).
	useEffect(() => {
		setSelected((s) => {
			const len = flatListLength(stage, result);
			return len === 0 ? 0 : Math.min(s, len - 1);
		});
	}, [stage, result]);

	const openOverlay = useCallback((seedQuery: string) => {
		setOpen(true);
		setStage("compact");
		setScopeKind("workspace");
		setQueryState(seedQuery);
		setSelected(0);
		setResult(null);
		setError(false);
	}, []);

	const close = useCallback(() => setOpen(false), []);

	const setQuery = useCallback((q: string) => {
		setQueryState(q);
		setSelected(0);
	}, []);

	const cycleScope = useCallback(() => {
		// The modulo always lands in range given `k` is itself a SCOPE_ORDER member — `?? k` is just to
		// satisfy noUncheckedIndexedAccess, never an actual fallback in practice.
		setScopeKind((k) => SCOPE_ORDER[(SCOPE_ORDER.indexOf(k) + 1) % SCOPE_ORDER.length] ?? k);
		setSelected(0);
	}, []);

	const toggleStage = useCallback(() => {
		setStage((s) => (s === "compact" ? "zoomed" : "compact"));
	}, []);

	const moveSelection = useCallback(
		(delta: number) => {
			setSelected((s) => {
				const len = flatListLength(stage, result);
				if (len === 0) return 0;
				return (s + delta + len) % len;
			});
		},
		[stage, result],
	);

	const selectedItem = useCallback(
		() => resolveHistorySelection(stage, result, selected),
		[stage, result, selected],
	);

	// Enter on a mapped message hit: jump to it via the store's `chatLocationRequest` deep link (see
	// `store/SPEC.md`), then close the overlay. An unmapped hit (`hit.workspaceId` absent) is a no-op —
	// belt-and-suspenders with `HistoryOverlay`'s own gating (it never calls this for an unmapped hit).
	const openMessage = useCallback(
		(hit: MessageHit) => {
			if (!hit.workspaceId) return;
			useAppStore.getState().requestChatLocation({
				workspaceId: hit.workspaceId,
				sessionId: hit.sessionId,
				messageIndex: hit.messageIndex,
				anchorText: hit.anchorText,
			});
			close();
		},
		[close],
	);

	const state = useMemo<HistorySearchState>(
		() => ({ open, stage, query, scope, result, selected, error }),
		[open, stage, query, scope, result, selected, error],
	);

	return {
		state,
		openOverlay,
		close,
		setQuery,
		cycleScope,
		toggleStage,
		moveSelection,
		selectedItem,
		openMessage,
	};
}
