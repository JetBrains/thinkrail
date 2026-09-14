import type {
	PiEvent,
	SessionEventPayload,
	SessionSummary,
	TodoPlan,
	TranscriptMessage,
} from "@thinkrail/contracts";
import { TODO_NUDGE_PREFIX, WS_CHANNELS } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { tupleKey } from "../lib";
import { isConnectedGeneration, type SessionRuntime, selectChatTitle, useAppStore } from "../store";
import { errorText, getSessionMessagesWithSkillBaseline, getTransport } from "../transport";
import { messagesToRuntime } from "./hydrate";
import { sessionGlance, shouldNudgeOnAdd } from "./planView";

export function shouldRefreshTodos(event: PiEvent): boolean {
	return event.type === "tool_execution_end" || event.type === "agent_settled";
}

export function todoReadFailureState(
	readGeneration: number,
	latestReadGeneration: number,
	hasLoadedPlan: boolean,
): boolean | null {
	return readGeneration === latestReadGeneration ? !hasLoadedPlan : null;
}

type TodoInvalidationListener = {
	source: object;
	invalidate: () => void;
};

export function createTodoInvalidationSignal() {
	const listenersByIdentity = new Map<string, Set<TodoInvalidationListener>>();
	return {
		subscribe(identity: string, listener: TodoInvalidationListener): () => void {
			const listeners = listenersByIdentity.get(identity) ?? new Set<TodoInvalidationListener>();
			listeners.add(listener);
			listenersByIdentity.set(identity, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) listenersByIdentity.delete(identity);
			};
		},
		invalidate(identity: string, source: object): void {
			for (const listener of listenersByIdentity.get(identity) ?? []) {
				if (listener.source !== source) listener.invalidate();
			}
		},
	};
}

const todoInvalidationSignal = createTodoInvalidationSignal();

export interface ChatTodos {
	data: TodoPlan | null;
	failed: boolean;
	reload: () => Promise<boolean>;
	add: (title: string) => Promise<void>;
	remove: (id: string) => Promise<void>;
	openPlan: () => void;
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
	const initializedIdentity = useRef<string | null>(null);
	const hasLoadedPlan = useRef(false);
	const invalidationSource = useRef<object>({}).current;
	currentIdentity.current = identity;
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
	const reviewerRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (status !== "connected" || connectionGeneration === 0) return;
		let cancelled = false;
		const effectIdentity = identity;
		const effectConnectionGeneration = connectionGeneration;
		const load = (reset: boolean) => {
			const mine = ++readGeneration.current;
			if (reset) {
				hasLoadedPlan.current = false;
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
						reviewerRef.current = plan.reviewerSessionId;
						hasLoadedPlan.current = true;
						setData(plan);
						setFailed(false);
					}
				})
				.catch(() => {
					if (
						!cancelled &&
						isConnectedGeneration(useAppStore.getState(), effectConnectionGeneration) &&
						live(effectIdentity)
					) {
						const failure = todoReadFailureState(
							mine,
							readGeneration.current,
							hasLoadedPlan.current,
						);
						if (failure !== null) setFailed(failure);
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
		const unsubscribeInvalidation = todoInvalidationSignal.subscribe(identity, {
			source: invalidationSource,
			invalidate: scheduleRefetch,
		});
		const unsubscribe = getTransport().subscribe(WS_CHANNELS.piEvent, (payload) => {
			const event = payload as SessionEventPayload;
			if (event.sessionId !== sessionId && event.sessionId !== reviewerRef.current) return;
			if (shouldRefreshTodos(event.event)) scheduleRefetch();
		});
		return () => {
			cancelled = true;
			readGeneration.current += 1;
			if (refetch) clearTimeout(refetch);
			unsubscribeInvalidation();
			unsubscribe();
		};
	}, [connectionGeneration, identity, invalidationSource, live, sessionId, status, workspaceId]);

	const add = async (rawTitle: string) => {
		const title = rawTitle.trim();
		if (!title) return;
		const requestIdentity = identity;
		const todo = await getTransport().request("todo.add", { workspaceId, sessionId, title });
		todoInvalidationSignal.invalidate(requestIdentity, invalidationSource);
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
		void nudgeAgent(workspaceId, sessionId, title);
	};

	const reloadPlan = async (reportFailure = false): Promise<boolean> => {
		const requestIdentity = identity;
		const requestState = useAppStore.getState();
		if (requestState.status !== "connected" || requestState.connectionGeneration === 0)
			return false;
		const requestConnectionGeneration = requestState.connectionGeneration;
		const mine = ++readGeneration.current;
		if (reportFailure && live(requestIdentity)) setFailed(false);
		try {
			const plan = await getTransport().request("todo.list", { workspaceId, sessionId });
			const current = useAppStore.getState();
			if (
				current.status === "connected" &&
				current.connectionGeneration !== requestConnectionGeneration &&
				readGeneration.current === mine &&
				live(requestIdentity)
			) {
				return reloadPlan(reportFailure);
			}
			if (
				readGeneration.current !== mine ||
				!isConnectedGeneration(current, requestConnectionGeneration) ||
				!live(requestIdentity)
			) {
				return false;
			}
			reviewerRef.current = plan.reviewerSessionId;
			hasLoadedPlan.current = true;
			setData(plan);
			setFailed(false);
			return true;
		} catch {
			const current = useAppStore.getState();
			if (isConnectedGeneration(current, requestConnectionGeneration) && live(requestIdentity)) {
				const failure = todoReadFailureState(mine, readGeneration.current, hasLoadedPlan.current);
				if (failure !== null) setFailed(failure);
			}
			return false;
		}
	};

	const remove = async (id: string) => {
		const requestIdentity = identity;
		setData((current) =>
			current
				? {
						todos: current.todos.filter((t) => t.id !== id),
						groups: current.groups
							.map((g) => ({ ...g, todos: g.todos.filter((t) => t.id !== id) }))
							.filter((g) => g.todos.length > 0),
					}
				: current,
		);
		try {
			await getTransport().request("todo.remove", { workspaceId, sessionId, id });
			todoInvalidationSignal.invalidate(requestIdentity, invalidationSource);
			if (live(requestIdentity)) await reloadPlan();
		} catch (err) {
			if (live(requestIdentity)) await reloadPlan();
			console.warn("todo remove failed:", errorText(err));
		}
	};

	const openPlan = () => {
		const state = useAppStore.getState();
		const title = selectChatTitle(state, workspaceId, sessionId);
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
		const requestIdentity = identity;
		await getTransport().request("todo.startReview", { workspaceId, sessionId, id });
		todoInvalidationSignal.invalidate(requestIdentity, invalidationSource);
		if (live(requestIdentity)) await reloadPlan();
	};

	const reviewAll = async () => {
		const requestIdentity = identity;
		const { total, alreadyRunning } = await getTransport().request("todo.reviewAll", {
			workspaceId,
			sessionId,
		});
		todoInvalidationSignal.invalidate(requestIdentity, invalidationSource);
		if (live(requestIdentity)) await reloadPlan();
		return { total, ...(alreadyRunning ? { alreadyRunning } : {}) };
	};

	return {
		data,
		failed,
		reload: () => reloadPlan(true),
		add,
		remove,
		openPlan,
		openChanges,
		startReview,
		reviewAll,
	};
}

type TodoNudgeRuntime = Pick<
	SessionRuntime,
	"askAnswers" | "controlTurnBoundary" | "isStreaming" | "syncedConnectionGeneration" | "turns"
>;

export interface TodoNudgeState {
	status: ReturnType<typeof useAppStore.getState>["status"];
	connectionGeneration: number;
	removedWorkspaceIds: Record<string, true>;
	deletedSessionsByWorkspace: Record<string, Record<string, true>>;
	sessions: Record<string, TodoNudgeRuntime>;
}

export interface TodoNudgeDependencies {
	state: () => TodoNudgeState;
	read: (params: {
		workspaceId: string;
		sessionId: string;
	}) => Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }>;
	send: (
		method: "session.followUp" | "session.prompt",
		params: { sessionId: string; text: string },
	) => Promise<void>;
}

const todoNudgeDependencies: TodoNudgeDependencies = {
	state: useAppStore.getState,
	read: async (params) => (await getSessionMessagesWithSkillBaseline(params)).result,
	send: async (method, params) => {
		await getTransport().request(method, params);
	},
};

function todoNudgeIsCurrent(
	workspaceId: string,
	sessionId: string,
	connectionGeneration: number,
	deps: TodoNudgeDependencies,
): boolean {
	const state = deps.state();
	return (
		isConnectedGeneration(state, connectionGeneration) &&
		!state.removedWorkspaceIds[workspaceId] &&
		!state.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
	);
}

async function readTodoNudgeRuntime(
	workspaceId: string,
	sessionId: string,
	connectionGeneration: number,
	deps: TodoNudgeDependencies,
): Promise<TodoNudgeRuntime | null> {
	if (!todoNudgeIsCurrent(workspaceId, sessionId, connectionGeneration, deps)) return null;
	const { summary, messages } = await deps.read({ workspaceId, sessionId });
	if (
		!todoNudgeIsCurrent(workspaceId, sessionId, connectionGeneration, deps) ||
		summary.workspaceId !== workspaceId ||
		summary.sessionId !== sessionId
	) {
		return null;
	}
	const hydrated = messagesToRuntime(messages, summary.lastSettlement, {
		includeControlMessages: true,
	});
	return {
		turns: hydrated.turns,
		askAnswers: hydrated.askAnswers,
		controlTurnBoundary: hydrated.controlTurnBoundary ?? 0,
		isStreaming: summary.isStreaming,
		syncedConnectionGeneration: connectionGeneration,
	};
}

export async function nudgeAgent(
	workspaceId: string,
	sessionId: string,
	title: string,
	deps: TodoNudgeDependencies = todoNudgeDependencies,
): Promise<void> {
	const initial = deps.state();
	const connectionGeneration = initial.connectionGeneration;
	if (
		connectionGeneration === 0 ||
		!todoNudgeIsCurrent(workspaceId, sessionId, connectionGeneration, deps)
	) {
		return;
	}
	const text = `${TODO_NUDGE_PREFIX}A TODO was added to the list: "${title}". Read the TODO list with todo_list and work any pending items, marking each done with todo_update as you finish.`;
	try {
		const known = initial.sessions[sessionId];
		let runtime =
			known?.syncedConnectionGeneration === connectionGeneration
				? known
				: await readTodoNudgeRuntime(workspaceId, sessionId, connectionGeneration, deps);
		if (runtime && !shouldNudgeOnAdd(sessionGlance(runtime))) {
			runtime = await readTodoNudgeRuntime(workspaceId, sessionId, connectionGeneration, deps);
		}
		if (
			!runtime ||
			!shouldNudgeOnAdd(sessionGlance(runtime)) ||
			!todoNudgeIsCurrent(workspaceId, sessionId, connectionGeneration, deps)
		) {
			return;
		}
		try {
			await deps.send(runtime.isStreaming ? "session.followUp" : "session.prompt", {
				sessionId,
				text,
			});
		} catch {
			const fresh = await readTodoNudgeRuntime(workspaceId, sessionId, connectionGeneration, deps);
			if (
				!fresh ||
				!shouldNudgeOnAdd(sessionGlance(fresh)) ||
				!todoNudgeIsCurrent(workspaceId, sessionId, connectionGeneration, deps)
			) {
				return;
			}
			await deps.send(fresh.isStreaming ? "session.followUp" : "session.prompt", {
				sessionId,
				text,
			});
		}
	} catch (err) {
		console.warn("todo nudge skipped:", errorText(err));
	}
}
