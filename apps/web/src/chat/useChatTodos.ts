import type { SessionEventPayload, TodoPlan } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { selectWorkspaceTick, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { messagesToRuntime, TODO_NUDGE_PREFIX } from "./hydrate";
import { planToMarkdown } from "./planMarkdown";

export interface ChatTodos {
	/** The chat's plan (loose items + groups), or null while the first load is in flight. */
	data: TodoPlan | null;
	/** True when the initial load failed (a live refetch failure keeps the current plan). */
	failed: boolean;
	/** Append a user (loose) item and nudge the agent to pick it up. Rejects if the add fails (the caller
	 * keeps the user's typed text so they can retry). */
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
 * edit ops. Adding an item nudges the agent (see {@link nudgeAgent}).
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
 */
async function nudgeAgent(workspaceId: string, sessionId: string, title: string): Promise<void> {
	const text = `${TODO_NUDGE_PREFIX}A TODO was added to the list: "${title}". Read the TODO list with todo_list and work any pending items, marking each done with todo_update as you finish.`;
	const streaming = useAppStore.getState().sessions[sessionId]?.isStreaming ?? false;
	try {
		await getTransport().request(streaming ? "session.followUp" : "session.prompt", {
			sessionId,
			text,
		});
	} catch {
		try {
			const syncedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
			const { summary, messages } = await getTransport().request("session.getMessages", {
				sessionId,
				workspaceId,
			});
			useAppStore
				.getState()
				.hydrateSession(summary, messagesToRuntime(messages), false, syncedTick);
			await getTransport().request("session.prompt", { sessionId, text });
		} catch (err) {
			console.warn("todo nudge skipped:", errorText(err));
		}
	}
}
