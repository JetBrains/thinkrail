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
	/** The chat's plan (loose items + groups), or null while the first load is in flight. */
	data: TodoPlan | null;
	/** True when the initial load failed (a live refetch failure keeps the current plan). */
	failed: boolean;
	/** Append a user (loose) item and nudge the agent to pick it up — unless it's waiting on the user
	 * (then the item just queues, see {@link nudgeAgent}). Rejects if the add fails (the caller keeps the
	 * user's typed text so they can retry). */
	add: (title: string) => Promise<void>;
	/** Remove an item. Optimistic — the row disappears immediately and is restored if the request fails. */
	remove: (id: string) => Promise<void>;
	/** Open (or focus) the chat's live plan page — a center `plan` tab (markdown is its export). */
	openPlan: () => void;
	/** Open an item's change set (the plan's "N files" chip): `{sha}` → the Changes panel at that commit's
	 * scope (durable done-time diff); `{path}` → that file's live diff tab at the branch scope. */
	openChanges: (target: { sha: string } | { path: string }) => void;
}

/**
 * The chat's TODO list as shared state (SPEC §Chat TODO plan): the data source shared by the in-chat plan
 * popup and live plan page. Reads `todo.list` for `sessionId`, refetches off that session's `pi.event`s (any tool end /
 * settled turn, debounced) so the agent's writes surface without a manual refresh, and exposes the user's
 * edit ops. Adding an item nudges the agent to pick it up, except while it's waiting on the user (see
 * {@link nudgeAgent}).
 */
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
		// A turn can end many tools in quick succession; coalesce the live refetches into one trailing
		// call so we don't fire a `todo.list` round-trip (and a popover re-render) per tool end.
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
		// Let a rejection propagate (no local update, no nudge) so the caller can keep the typed text.
		const requestIdentity = identity;
		const todo = await getTransport().request("todo.add", { workspaceId, sessionId, title });
		if (!live(requestIdentity)) return;
		readGeneration.current += 1;
		// A user add is always loose (never grouped). A concurrent authoritative refetch may already contain
		// the accepted item, so fold by id rather than appending a duplicate.
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

	/**
	 * Re-read the plan from the host after a user edit. Necessary because a group carries a **host-derived**
	 * `status` (contracts' `TodoGroupStatus`) that this app deliberately can't recompute: a locally patched
	 * plan would keep the pre-edit status — remove a group's last open step and it would sit under "To do"
	 * reading `1/1`, or keep an active spinner, until some unrelated `pi.event` refetch happened to land.
	 * A failed re-read leaves the optimistic view in place; the live refetch reconciles it later.
	 */
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
			// Keep what's on screen — the next pi.event-driven refetch will reconcile.
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
				await reloadPlan(); // the surviving groups' derived status is the host's to recompute
			}
		} catch (err) {
			// Never restore a whole captured plan over concurrent edits. Re-read the host to recover the failed
			// item; if that read also fails, the next pi.event-driven refresh converges without stale overwrite.
			if (live(requestIdentity)) await reloadPlan();
			console.warn("todo remove failed:", errorText(err));
		}
	};

	const openPlan = () => {
		const state = useAppStore.getState();
		const title = selectChatTitle(state, workspaceId, sessionId);
		state.openDoc({
			kind: "plan",
			// Keyed per chat, so re-clicking focuses the same page rather than piling up tabs.
			id: `${workspaceId}:plan:${sessionId}`,
			workspaceId,
			name: `Plan · ${title}`,
			sessionId,
		});
	};

	const openChanges = (target: { sha: string } | { path: string }) => {
		const store = useAppStore.getState();
		if ("sha" in target) {
			// The commit is the change set: point the panel's scope at it and reveal Changes — the panel
			// lists the commit's files itself, each opening its diff at that scope.
			store.setDiffScope(workspaceId, { kind: "commit", sha: target.sha });
			store.enqueueLayoutIntent({ kind: "reveal-tool", workspaceId, tool: "changes" });
			return;
		}
		// Path-list fallback: a live diff — pin the scope back to branch so the deep link can't inherit a
		// commit scope a previous chip click left behind, then route the one-path intent.
		store.setDiffScope(workspaceId, { kind: "branch" });
		store.requestChangesView(workspaceId, target.path);
	};

	return { data, failed, add, remove, openPlan, openChanges };
}

/**
 * Wake the agent to pick up a just-added item (else it waits until the user chats): `session.prompt` when
 * the chat is idle, `session.followUp` when mid-turn. The prompt is hidden from the transcript (the
 * `TODO_NUDGE_PREFIX` marker). Best-effort — if the session isn't live (e.g. a host restart), re-open it
 * from disk and retry; otherwise drop it quietly (the item is added regardless).
 *
 * **Never wakes an agent that's waiting on the user** ({@link shouldNudgeOnAdd}): while an
 * `ask_user_question` is pending the item just queues at the end untouched — waking the agent would send
 * it off to work the new item and forget to return to its own question (the reported bug).
 */
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
