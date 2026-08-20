import type {
	HistoryScope,
	HistorySearchResult,
	MessageHit,
	PromptHit,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ChatLocationRequest, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export type { ChatLocationRequest };

export type HistoryStage = "compact" | "zoomed";

export interface HistorySearchState {
	open: boolean;
	stage: HistoryStage;
	query: string;
	scope: HistoryScope;
	result: HistorySearchResult | null;
	selected: number;
	error: boolean;
}

export type HistorySelection =
	| { kind: "prompt"; hit: PromptHit }
	| { kind: "message"; hit: MessageHit };

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
			return { kind: "project", projectId: projectId ?? "" };
		case "all":
			return { kind: "all" };
	}
}

function flatListLength(stage: HistoryStage, result: HistorySearchResult | null): number {
	if (!result) return 0;
	return stage === "compact"
		? result.prompts.length
		: result.prompts.length + result.messages.length;
}

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

export function jumpTarget(hit: PromptHit | MessageHit): ChatLocationRequest | null {
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
		setScopeKind((k) => SCOPE_ORDER[(SCOPE_ORDER.indexOf(k) + 1) % SCOPE_ORDER.length] ?? k);
		resetForParamsChange();
	}, [resetForParamsChange]);

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

	const openMessage = useCallback(
		async (target: ChatLocationRequest) => {
			if (!useAppStore.getState().workspaces[target.projectId]?.length) {
				try {
					const list = await getTransport().request("workspace.list", {
						projectId: target.projectId,
					});
					useAppStore.getState().setWorkspaces(target.projectId, list);
				} catch {}
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
