import type { PiEvent, SessionEventPayload, TodoPlan } from "@thinkrail/contracts";
import { TODO_NUDGE_PREFIX, WS_CHANNELS } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { tupleKey } from "../lib";
import { isConnectedGeneration, selectChatTitle, useAppStore } from "../store";
import { errorText, getSessionMessagesWithSkillBaseline, getTransport } from "../transport";
import { messagesToRuntime } from "./hydrate";
import { sessionGlance, shouldNudgeOnAdd } from "./planView";

export function shouldRefreshTodos(event: PiEvent): boolean {
	return event.type === "tool_execution_end" || event.type === "agent_settled";
}

export interface ChatTodos {
	data: TodoPlan | null;
	failed: boolean;
	add: (title: string) => Promise<void>;
	remove: (id: string) => Promise<void>;
	openPlan: () => void;
	openChanges: (target: { sha: string } | { path: string }) => void;
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
		return () => {
			cancelled = true;
			readGeneration.current += 1;
			if (refetch) clearTimeout(refetch);
			unsubscribe();
		};
	}, [connectionGeneration, identity, live, sessionId, status, workspaceId]);

	const add = async (rawTitle: string) => {
		const title = rawTitle.trim();
		if (!title) return;
		const requestIdentity = identity;
		const todo = await getTransport().request("todo.add", { workspaceId, sessionId, title });
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

	const reloadPlan = async (): Promise<boolean> => {
		const requestIdentity = identity;
		const requestState = useAppStore.getState();
		const requestConnectionGeneration =
			requestState.status === "connected" ? requestState.connectionGeneration : null;
		const mine = ++readGeneration.current;
		try {
			const plan = await getTransport().request("todo.list", { workspaceId, sessionId });
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
		} catch {
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
			if (live(requestIdentity)) {
				await reloadPlan();
			}
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

	return { data, failed, add, remove, openPlan, openChanges };
}

async function nudgeAgent(workspaceId: string, sessionId: string, title: string): Promise<void> {
	const initial = useAppStore.getState();
	if (
		initial.removedWorkspaceIds[workspaceId] ||
		initial.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
	) {
		return;
	}
	const session = initial.sessions[sessionId];
	if (session && !shouldNudgeOnAdd(sessionGlance(session))) return;
	const streaming = session?.isStreaming ?? false;
	const text = `${TODO_NUDGE_PREFIX}A TODO was added to the list: "${title}". Read the TODO list with todo_list and work any pending items, marking each done with todo_update as you finish.`;
	try {
		await getTransport().request(streaming ? "session.followUp" : "session.prompt", {
			sessionId,
			text,
		});
	} catch {
		try {
			const {
				result: { summary, messages },
				syncedTick,
			} = await getSessionMessagesWithSkillBaseline({ sessionId, workspaceId });
			const current = useAppStore.getState();
			if (
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
