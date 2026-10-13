import type {
	PiEvent,
	ReviewChangedPayload,
	ReviewFailedPayload,
	SessionEventPayload,
	TodoPlan,
} from "@thinkrail/contracts";
import { TODO_NUDGE_PREFIX, WS_CHANNELS } from "@thinkrail/contracts";
import { useCallback, useEffect, useInsertionEffect, useRef, useState } from "react";
import { tupleKey } from "../lib";
import {
	isConnectedGeneration,
	selectChatTitle,
	selectHasNormalizedSessionState,
	toast,
	useAppStore,
} from "../store";
import {
	errorText,
	getSessionMessagesWithSkillBaseline,
	getTransport,
	supportsPlanSummaryGeneration,
} from "../transport";
import { messagesToRuntime } from "./hydrate";
import { sessionGlance, shouldNudgeOnAdd } from "./planView";

export function shouldRefreshTodos(event: PiEvent): boolean {
	return event.type === "tool_execution_end" || event.type === "agent_settled";
}

// Cross-instance refetch bus for `useChatTodos`.
//
// Multiple surfaces (the rail `PlanRailPane`, the center `PlanPane`, the chat strip) each call
// `useChatTodos(workspaceId, sessionId)` and hold their OWN React state. The server-driven refetch
// only fires on agent events (`tool_execution_end` / `agent_settled`), so a user-initiated edit
// (todo.add from the rail) stayed invisible to the already-open Plan page until the agent happened
// to tick \u2014 fine on fast runs, deterministically broken on binary/desktop. This module-local
// bus lets a successful local write signal every other hook for the same chat key to reload.
const todoRefetchBus = new Map<string, Set<() => void>>();
export function subscribeTodoRefetch(key: string, listener: () => void): () => void {
	let set = todoRefetchBus.get(key);
	if (!set) {
		set = new Set();
		todoRefetchBus.set(key, set);
	}
	set.add(listener);
	return () => {
		const current = todoRefetchBus.get(key);
		current?.delete(listener);
		if (current && current.size === 0) todoRefetchBus.delete(key);
	};
}
export function signalTodoRefetch(key: string, except?: () => void): void {
	const listeners = todoRefetchBus.get(key);
	if (!listeners) return;
	// Snapshot the Set before dispatch: a Set that gains entries mid-iteration would visit the newly
	// added ones in the same loop (per JS spec), which would run a listener for a signal it wasn't
	// subscribed to yet — a double-work hazard when a React render-time subscribe coincides with
	// a sibling's write. The optional `except` lets the originating hook skip itself (it already
	// reloaded via its local write path; another scheduled reload would be redundant work). A
	// listener's synchronous throw must not swallow its siblings' signal (unmount races, stale
	// closures), so dispatch is isolated per listener.
	for (const listener of [...listeners]) {
		if (listener === except) continue;
		try {
			listener();
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("[useChatTodos] refetch listener threw; ignored to keep bus delivering", error);
		}
	}
}

// The content eligibility for an auto-drafted plan summary: every step done and no summary yet (agent- or
// previously auto-authored). The host-capability gate (`supportsPlanSummaryGeneration`) is applied
// separately, so the request fires only when this holds AND the connected host advertises v69+.
export function planIsCompleteWithoutSummary(
	plan: Pick<TodoPlan, "todos" | "groups" | "summary">,
): boolean {
	if (plan.summary) return false;
	const items = [...plan.todos, ...plan.groups.flatMap((group) => group.todos)];
	return items.length > 0 && items.every((todo) => todo.status === "done");
}

export interface ChatTodos {
	data: TodoPlan | null;
	failed: boolean;
	add: (title: string, surface?: "chat" | "page") => Promise<void>;
	openPlan: () => void;
	notifyOpened: (surface: "rail") => void;
	openChanges: (target: { sha: string } | { path: string }) => void;
	startReview: (id: string) => Promise<void>;
	reviewAll: () => Promise<{ total: number; alreadyRunning?: boolean }>;
}

export function useChatTodos(workspaceId: string, sessionId: string): ChatTodos {
	const [data, setData] = useState<TodoPlan | null>(null);
	const [failed, setFailed] = useState(false);
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const identity = tupleKey("chat-todos", workspaceId, sessionId);
	const currentIdentity = useRef(identity);
	const readGeneration = useRef(0);
	// Captures our own bus listener so write-path `signalTodoRefetch(identity, selfListenerRef.current)`
	// skips firing to ourselves. We already reloaded through the local write path (optimistic patch
	// + explicit `reloadPlan`); another scheduled reload would be redundant work.
	const selfListenerRef = useRef<(() => void) | null>(null);
	const initializedIdentity = useRef<string | null>(null);
	useInsertionEffect(() => {
		currentIdentity.current = identity;
	}, [identity]);
	const live = useCallback(
		(expectedIdentity: string) => {
			const state = useAppStore.getState();
			return (
				currentIdentity.current === expectedIdentity &&
				!state.removedWorkspaceIds[workspaceId] &&
				!state.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
			);
		},
		[sessionId, workspaceId],
	);
	useEffect(() => {
		if (status !== "connected" || connectionGeneration === 0) return;
		let cancelled = false;
		const effectIdentity = identity;
		const effectConnectionGeneration = connectionGeneration;
		const load = (reset: boolean) => {
			const mine = ++readGeneration.current;
			if (reset) {
				setData(null);
				setFailed(false);
			}
			getTransport()
				.request("todo.list", { workspaceId, sessionId })
				.then((plan) => {
					if (
						!cancelled &&
						readGeneration.current === mine &&
						isConnectedGeneration(useAppStore.getState(), effectConnectionGeneration) &&
						live(effectIdentity)
					) {
						setData(plan);
						setFailed(false);
					}
				})
				.catch(() => {
					if (
						!cancelled &&
						reset &&
						readGeneration.current === mine &&
						isConnectedGeneration(useAppStore.getState(), effectConnectionGeneration) &&
						live(effectIdentity)
					) {
						setFailed(true);
					}
				});
		};
		const reset = initializedIdentity.current !== identity;
		initializedIdentity.current = identity;
		load(reset);
		let refetch: ReturnType<typeof setTimeout> | undefined;
		const scheduleRefetch = () => {
			if (refetch) clearTimeout(refetch);
			refetch = setTimeout(() => load(false), 250);
		};
		const unsubscribe = getTransport().subscribe(WS_CHANNELS.piEvent, (payload) => {
			const event = payload as SessionEventPayload;
			if (event.sessionId !== sessionId) return;
			if (shouldRefreshTodos(event.event)) scheduleRefetch();
		});
		// Cross-instance refetch bus: a sibling hook (rail or page) wrote to this chat's plan and now
		// signals every other mounted hook to reload. Debounces through the same `scheduleRefetch`.
		selfListenerRef.current = scheduleRefetch;
		const unsubscribeBus = subscribeTodoRefetch(identity, scheduleRefetch);
		// A plan review runs as a hidden subagent (no piEvent for this session) and writes its verdict to the
		// review record; the host re-broadcasts reviewChanged when it lands, so refetch the plan to show it.
		// The same broadcast fires for any review edit (a finding deleted/resolved can clear a step's
		// host-derived changes_requested decoration), so this one subscription covers those too.
		const unsubscribeReview = getTransport().subscribe(WS_CHANNELS.reviewChanged, (payload) => {
			if ((payload as ReviewChangedPayload).workspaceId === workspaceId) scheduleRefetch();
		});
		// A detached review has no chat to carry a failure; the owning plan raises it as a toast (routed by
		// sessionId, deduped across split views by the toast body). See panels/SPEC.md.
		const unsubscribeReviewFailed = getTransport().subscribe(
			WS_CHANNELS.reviewFailed,
			(payload) => {
				const failure = payload as ReviewFailedPayload;
				if (failure.workspaceId !== workspaceId || failure.sessionId !== sessionId) return;
				toast.error(failure.message, `Review of “${failure.itemTitle}” failed`);
			},
		);
		return () => {
			cancelled = true;
			readGeneration.current += 1;
			if (refetch) clearTimeout(refetch);
			unsubscribe();
			unsubscribeBus();
			unsubscribeReview();
			unsubscribeReviewFailed();
		};
	}, [connectionGeneration, identity, live, sessionId, status, workspaceId]);

	// When a completed plan carries no agent-authored summary, ask the host to draft one once (a
	// best-effort cheap-model one-shot). Re-armed if the plan re-opens or its summary clears.
	const summaryTriedRef = useRef(false);
	useEffect(() => {
		if (!data) return;
		if (!planIsCompleteWithoutSummary(data)) {
			summaryTriedRef.current = false;
			return;
		}
		// Only ask hosts that advertise the capability (v69+); an older host has no such method.
		if (!supportsPlanSummaryGeneration(useAppStore.getState().protocolVersion)) return;
		if (summaryTriedRef.current) return;
		summaryTriedRef.current = true;
		const requestIdentity = identity;
		getTransport()
			.request("todo.generateSummary", { workspaceId, sessionId })
			.then((res) => {
				const summary = res.summary;
				if (!summary || !live(requestIdentity)) return;
				setData((prev) => (prev && !prev.summary ? { ...prev, summary } : prev));
			})
			.catch(() => {});
	}, [data, identity, live, sessionId, workspaceId]);

	const add = async (rawTitle: string, surface: "chat" | "page" = "chat") => {
		const title = rawTitle.trim();
		if (!title) return;
		const requestIdentity = identity;
		const todo = await getTransport().request("todo.add", {
			workspaceId,
			sessionId,
			title,
			surface,
		});
		if (!live(requestIdentity)) return;
		readGeneration.current += 1;
		setData((prev) =>
			prev &&
			![...prev.todos, ...prev.groups.flatMap((group) => group.todos)].some(
				(candidate) => candidate.id === todo.id,
			)
				? { ...prev, todos: [...prev.todos, todo] }
				: prev,
		);
		// Tell sibling hooks for the SAME chat (rail \u2194 page \u2194 strip) to reload so a user add
		// is visible on every surface, not only the one that invoked it. The local optimistic patch
		// above keeps our own render instant; siblings pick up the real plan from `todo.list`.
		signalTodoRefetch(requestIdentity, selfListenerRef.current ?? undefined);
		void nudgeAgent(workspaceId, sessionId, title);
	};

	const reloadPlan = async (): Promise<boolean> => {
		const requestIdentity = identity;
		const requestState = useAppStore.getState();
		const requestConnectionGeneration =
			requestState.status === "connected" ? requestState.connectionGeneration : null;
		const mine = ++readGeneration.current;
		const plan = await getTransport()
			.request("todo.list", { workspaceId, sessionId })
			.catch(() => null);
		if (!plan) return false;
		const current = useAppStore.getState();
		if (
			requestConnectionGeneration !== null &&
			current.connectionGeneration !== requestConnectionGeneration &&
			readGeneration.current === mine &&
			live(requestIdentity)
		) {
			return reloadPlan();
		}
		if (readGeneration.current !== mine || !live(requestIdentity)) return false;
		setData(plan);
		return true;
	};

	const notifyOpened = (surface: "page" | "rail") => {
		void getTransport()
			.request("todo.list", { workspaceId, sessionId, opened: surface })
			.catch(() => {});
	};

	const openPlan = () => {
		// "Open plan" opens the document-scale Plan page in a center tab. The compact TODO list in the
		// right rail (PlanRailPane) is the always-on glance surface; the Plan page is the deep-review
		// surface (PlanSessionLive, PR actions, next-action banners, adopted commits, unattributed).
		// They complement each other — rail for the task list, page for the review trail.
		const state = useAppStore.getState();
		const title = selectChatTitle(state, workspaceId, sessionId);
		notifyOpened("page");
		state.openDoc({
			kind: "plan",
			id: `${workspaceId}:plan:${sessionId}`,
			workspaceId,
			name: `Plan · ${title}`,
			sessionId,
		});
	};

	const openChanges = (target: { sha: string } | { path: string }) => {
		const store = useAppStore.getState();
		if ("sha" in target) {
			store.setDiffScope(workspaceId, { kind: "commit", sha: target.sha });
			store.enqueueLayoutIntent({ kind: "reveal-tool", workspaceId, tool: "changes" });
			return;
		}
		store.setDiffScope(workspaceId, { kind: "branch" });
		store.requestChangesView(workspaceId, target.path);
	};

	const startReview = async (id: string) => {
		await getTransport().request("todo.startReview", { workspaceId, sessionId, id });
		await reloadPlan(); // the `reviewing` mark is host-derived — never patched locally
		signalTodoRefetch(identity, selfListenerRef.current ?? undefined); // and tell sibling hooks about it
	};

	const reviewAll = async () => {
		const { total, alreadyRunning } = await getTransport().request("todo.reviewAll", {
			workspaceId,
			sessionId,
		});
		await reloadPlan(); // the first item's `reviewing` mark is host-derived — re-read to show it
		signalTodoRefetch(identity, selfListenerRef.current ?? undefined);
		return { total, ...(alreadyRunning ? { alreadyRunning } : {}) };
	};

	return {
		data,
		failed,
		add,
		openPlan,
		notifyOpened: (surface: "rail") => notifyOpened(surface),
		openChanges,
		startReview,
		reviewAll,
	};
}

const runtimeHydration = new Map<string, Promise<void>>();

export function hydrateSessionRuntime(workspaceId: string, sessionId: string): Promise<void> {
	const state = useAppStore.getState();
	if (
		state.sessions[sessionId] ||
		state.removedWorkspaceIds[workspaceId] ||
		state.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
	) {
		return Promise.resolve();
	}
	const connectionGeneration = state.connectionGeneration;
	const key = tupleKey("session-runtime", workspaceId, sessionId, String(connectionGeneration));
	const existing = runtimeHydration.get(key);
	if (existing) return existing;
	const request = getSessionMessagesWithSkillBaseline({ sessionId, workspaceId })
		.then(({ result: { summary, messages }, syncedTick }) => {
			const current = useAppStore.getState();
			if (
				!isConnectedGeneration(current, connectionGeneration) ||
				current.removedWorkspaceIds[workspaceId] ||
				current.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
			) {
				return;
			}
			current.hydrateSession(
				summary,
				messagesToRuntime(messages, summary.lastSettlement),
				false,
				summary.live ? undefined : syncedTick,
				{ activate: false },
			);
		})
		.finally(() => runtimeHydration.delete(key));
	runtimeHydration.set(key, request);
	return request;
}

async function nudgeAgent(workspaceId: string, sessionId: string, title: string): Promise<void> {
	const state = useAppStore.getState();
	if (
		state.removedWorkspaceIds[workspaceId] ||
		state.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
	) {
		return;
	}
	const text = `${TODO_NUDGE_PREFIX}A TODO was added to the list: "${title}". Read the TODO list with todo_list and work any pending items, marking each done with todo_update as you finish.`;
	if (selectHasNormalizedSessionState(state)) {
		try {
			await getTransport().request("session.nudge", { workspaceId, sessionId, text });
		} catch (err) {
			console.warn("todo nudge skipped:", errorText(err));
		}
		return;
	}
	await legacyNudgeAgent(workspaceId, sessionId, text);
}

async function legacyNudgeAgent(
	workspaceId: string,
	sessionId: string,
	text: string,
): Promise<void> {
	const initial = useAppStore.getState();
	const session = initial.sessions[sessionId];
	if (session && !shouldNudgeOnAdd(sessionGlance(session))) return;
	try {
		await getTransport().request(session?.isStreaming ? "session.followUp" : "session.prompt", {
			sessionId,
			text,
		});
	} catch {
		try {
			await hydrateSessionRuntime(workspaceId, sessionId);
			const hydrated = useAppStore.getState();
			const recovered = hydrated.sessions[sessionId];
			if (
				hydrated.removedWorkspaceIds[workspaceId] ||
				hydrated.deletedSessionsByWorkspace[workspaceId]?.[sessionId] ||
				!recovered ||
				!shouldNudgeOnAdd(sessionGlance(recovered))
			) {
				return;
			}
			await getTransport().request("session.prompt", { sessionId, text });
		} catch (err) {
			console.warn("todo nudge skipped:", errorText(err));
		}
	}
}
