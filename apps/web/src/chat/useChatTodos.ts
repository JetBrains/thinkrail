import type { SessionEventPayload, TodoPlan } from "@thinkrail/contracts";
import { TODO_NUDGE_PREFIX, WS_CHANNELS } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { errorText, getSessionMessagesWithSkillBaseline, getTransport } from "../transport";
import { messagesToRuntime } from "./hydrate";
import { planToMarkdown } from "./planMarkdown";
import { sessionGlance, shouldNudgeOnAdd } from "./planView";

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
	/** Compile the current plan to a temporary markdown snapshot and open it in a center `doc` tab. */
	openMarkdown: () => void;
}

/**
 * The chat's TODO list as shared state (SPEC §Chat TODO plan): the single data source for the in-chat plan
 * popup. Reads `todo.list` for `sessionId`, refetches live off that session's `pi.event`s (any tool end /
 * settled turn, debounced) so the agent's writes surface without a manual refresh, and exposes the user's
 * edit ops. Adding an item nudges the agent to pick it up, except while it's waiting on the user (see
 * {@link nudgeAgent}).
 */
export function useChatTodos(workspaceId: string, sessionId: string): ChatTodos {
	const [data, setData] = useState<TodoPlan | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const load = (reset: boolean) => {
			if (reset) {
				setData(null);
				setFailed(false);
			}
			getTransport()
				.request("todo.list", { workspaceId, sessionId })
				.then((plan) => {
					if (!cancelled) {
						setData(plan);
						setFailed(false);
					}
				})
				.catch(() => {
					if (!cancelled && reset) setFailed(true);
				});
		};
		load(true);
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
			if (event.event.type === "tool_execution_end" || event.event.type === "agent_end") {
				scheduleRefetch();
			}
		});
		return () => {
			cancelled = true;
			if (refetch) clearTimeout(refetch);
			unsubscribe();
		};
	}, [workspaceId, sessionId]);

	const add = async (rawTitle: string) => {
		const title = rawTitle.trim();
		if (!title) return;
		// Let a rejection propagate (no local update, no nudge) so the caller can keep the typed text.
		const todo = await getTransport().request("todo.add", { workspaceId, sessionId, title });
		// A user add is always loose (never grouped).
		setData((prev) => (prev ? { ...prev, todos: [...prev.todos, todo] } : prev));
		void nudgeAgent(workspaceId, sessionId, title);
	};

	/**
	 * Re-read the plan from the host after a user edit. Necessary because a group carries a **host-derived**
	 * `status` (contracts' `TodoGroupStatus`) that this app deliberately can't recompute: a locally patched
	 * plan would keep the pre-edit status — remove a group's last open step and it would sit under "To do"
	 * reading `1/1`, or keep an active spinner, until some unrelated `pi.event` refetch happened to land.
	 * A failed re-read leaves the optimistic view in place; the live refetch reconciles it later.
	 */
	const reloadPlan = async () => {
		try {
			const plan = await getTransport().request("todo.list", { workspaceId, sessionId });
			setData(plan);
		} catch {
			// keep what's on screen — the next pi.event-driven refetch will reconcile
		}
	};

	const remove = async (id: string) => {
		let prev: TodoPlan | null = null;
		setData((current) => {
			prev = current;
			return current
				? {
						todos: current.todos.filter((t) => t.id !== id),
						groups: current.groups
							.map((g) => ({ ...g, todos: g.todos.filter((t) => t.id !== id) }))
							.filter((g) => g.todos.length > 0),
					}
				: current;
		});
		try {
			await getTransport().request("todo.remove", { workspaceId, sessionId, id });
			await reloadPlan(); // the surviving groups' derived status is the host's to recompute
		} catch (err) {
			// Roll the optimistic removal back so the UI doesn't diverge from disk on a failed request.
			setData(prev);
			console.warn("todo remove failed:", errorText(err));
		}
	};

	const openMarkdown = () => {
		if (!data) return;
		const tabs = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
		const chatTab = tabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
		const title = (chatTab?.name ?? "Chat").trim() || "Chat";
		useAppStore.getState().openDoc({
			kind: "doc",
			// Keyed per chat, so re-clicking refreshes the same tab rather than piling up snapshots.
			id: `${workspaceId}:doc:todo:${sessionId}`,
			workspaceId,
			name: `TODO · ${title}`,
			content: planToMarkdown(data, title),
			docPath: "TODO.md",
		});
	};

	return { data, failed, add, remove, openMarkdown };
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
	const session = useAppStore.getState().sessions[sessionId];
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
			useAppStore
				.getState()
				.hydrateSession(summary, messagesToRuntime(messages), false, syncedTick);
			await getTransport().request("session.prompt", { sessionId, text });
		} catch (err) {
			console.warn("todo nudge skipped:", errorText(err));
		}
	}
}
