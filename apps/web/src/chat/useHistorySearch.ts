import type {
	HistoryScope,
	HistorySearchResult,
	MessageHit,
	PromptHit,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ChatLocationRequest, useAppStore } from "@/store";
import { getTransport } from "@/transport";

// Re-exported so `HistoryOverlay.tsx` (props-driven, no store/transport of its own — see `chat/SPEC.md`'s
// boundary section) can type its `onOpenMessage` prop and call `jumpTarget` without importing `@/store`
// directly; this hook stays the one seam that does.
export type { ChatLocationRequest };

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

/** Exported so the scope picker (`HistoryOverlay`'s dropdown menu, R2) can render its four options in
 * this exact cycle order — the same order `Ctrl+R`'s `cycleScope` advances through. */
export const SCOPE_ORDER = ["chat", "workspace", "project", "all"] as const;
export type ScopeKind = (typeof SCOPE_ORDER)[number];

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
 * The `ChatLocationRequest` a hit resolves to, or `null` when it isn't jumpable. A `MessageHit` is
 * jumpable once mapped to a workspace (`workspaceId` present) — unchanged from before. A `PromptHit` is
 * jumpable once it also carries its kept-newest occurrence's `messageIndex`/`anchorText` — absent for an
 * unmapped-cwd hit, or a host that doesn't populate those two fields. Shared by `PromptRow`'s
 * go-to-chat icon, the overlay's `Shift+Enter` handler, and `MessageRow`'s click/`Enter` handler, so all
 * three gate on the exact same rule and can never disagree on "is this jumpable."
 */
export function jumpTarget(hit: PromptHit | MessageHit): ChatLocationRequest | null {
	// `workspaceId` and `projectId` are populated together by the host's `buildHistoryScope` labeler (both
	// from the same registry entry), so an unmapped-cwd hit lacks both; gate on both to be explicit.
	if (!hit.workspaceId || !hit.projectId || hit.messageIndex == null || hit.anchorText == null) {
		return null;
	}
	return {
		workspaceId: hit.workspaceId,
		projectId: hit.projectId,
		sessionId: hit.sessionId,
		messageIndex: hit.messageIndex,
		anchorText: hit.anchorText,
	};
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
	setScope: (kind: ScopeKind) => void;
	toggleStage: () => void;
	moveSelection: (delta: number) => void;
	openMessage: (target: ChatLocationRequest) => void;
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

	// A cold (first-ever) build returns a partial result with `indexing: true` once its budget expires —
	// otherwise correct, just not yet complete. Retry every 300ms for as long as the overlay stays open
	// and the latest result keeps reporting `indexing`, using a token of its own — never the debounce
	// effect's `tokenRef` above. Sharing one counter between two independently-triggered schedulers would
	// mean whichever fires *second* within the same render invalidates the other's already-in-flight
	// request even when that one is the more relevant of the two (e.g. a query edit arriving while a
	// retry happens to also be due: both effects would fire in the same pass, and a shared token would let
	// the retry's bump silently drop the fresh debounced response for the new query). Bumping
	// unconditionally before the early return mirrors the debounce effect's own token discipline, for the
	// same reason: a retry in flight when the overlay closes must never land after it reopens. Keyed on
	// `result` itself, not `result.indexing` — a same-valued `indexing: true` on every retry still
	// produces a *new* result object each `search()` call, which is what makes this effect re-fire and
	// reschedule the next retry; a boolean dep would fire once and never repeat.
	const retryTokenRef = useRef(0);
	useEffect(() => {
		const token = ++retryTokenRef.current;
		if (!open || !result?.indexing) return;
		const timer = setTimeout(() => {
			getTransport()
				.request("history.search", { query, scope, limit: 50 })
				.then((res) => {
					if (retryTokenRef.current !== token) return;
					setResult(res);
					setError(false);
				})
				.catch(() => {
					if (retryTokenRef.current !== token) return;
					setError(true);
				});
		}, 300);
		return () => clearTimeout(timer);
	}, [open, result, query, scope]);

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

	// A query or scope change makes the current result stale. Clear it — not just the selection — so
	// nothing (Enter / Ctrl+Enter / a row click) can act on a hit that no longer matches what the input
	// now shows, during the ~100ms debounce + request round-trip before fresh results land. Any prior
	// error clears too, since a fresh request is on its way.
	const resetForParamsChange = useCallback(() => {
		setSelected(0);
		setResult(null);
		setError(false);
	}, []);

	const setQuery = useCallback(
		(q: string) => {
			setQueryState(q);
			resetForParamsChange();
		},
		[resetForParamsChange],
	);

	const cycleScope = useCallback(() => {
		// The modulo always lands in range given `k` is itself a SCOPE_ORDER member — `?? k` is just to
		// satisfy noUncheckedIndexedAccess, never an actual fallback in practice.
		setScopeKind((k) => SCOPE_ORDER[(SCOPE_ORDER.indexOf(k) + 1) % SCOPE_ORDER.length] ?? k);
		resetForParamsChange();
	}, [resetForParamsChange]);

	// R2's mouse path: the scope picker's dropdown items pick a scope directly rather than stepping
	// through `cycleScope` — `Ctrl+R` keeps calling `cycleScope` above, unchanged. Clears the stale result
	// the same way cycling does, for the same reason (a scope change reshapes the results under it).
	const setScope = useCallback(
		(kind: ScopeKind) => {
			setScopeKind(kind);
			resetForParamsChange();
		},
		[resetForParamsChange],
	);

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

	// Jump to an already-resolved target (see `jumpTarget` above) via the store's `chatLocationRequest`
	// deep link (see `store/SPEC.md`), then close the overlay. Callers only ever pass a target `jumpTarget`
	// produced, so there's nothing left to gate here — the "is this jumpable" check happened at the call
	// site (the icon's render gate / `Shift+Enter` handler / message-hit click).
	//
	// A jump can cross into a project the user hasn't opened this session, whose workspace list the store
	// loads lazily (on project expansion). Fetch it first when absent so the atomic
	// `requestChatLocation` below leaves a resolvable `activeWorkspaceId` — otherwise `selectActiveWorkspace`
	// would return null and the destination would render blank. A failed fetch still records the request;
	// `ChatView`'s consumer surfaces "couldn't locate" if the workspace truly can't be resolved.
	const openMessage = useCallback(
		async (target: ChatLocationRequest) => {
			if (!useAppStore.getState().workspaces[target.projectId]?.length) {
				try {
					const list = await getTransport().request("workspace.list", {
						projectId: target.projectId,
					});
					useAppStore.getState().setWorkspaces(target.projectId, list);
				} catch {
					// fall through — record the request anyway; the consumer handles an unresolved target
				}
			}
			useAppStore.getState().requestChatLocation(target);
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
		setScope,
		toggleStage,
		moveSelection,
		openMessage,
	};
}
