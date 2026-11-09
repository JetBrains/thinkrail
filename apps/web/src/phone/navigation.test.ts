import { expect, test } from "bun:test";
import type { Project } from "@thinkrail/contracts";
import type { RemoteSessionItem } from "@thinkrail/remote-client";
import { chatSections, needsYouCount, settleDone } from "./chats";
import { leaveHost, pop, push, type Route, replaceTop } from "./navigation";

const host = (hostKey: string): Route => ({
	kind: "newWorktree",
	hostKey,
	project: { id: "p" } as Project,
});

test("back pops one screen; a resolved opener or a started worktree swaps the top so back skips it", () => {
	const stack = push(push([], host("a")), host("b"));
	expect(pop(stack)).toEqual([host("a")]);
	expect(replaceTop(stack, host("c"))).toEqual([host("a"), host("c")]);
});

test("losing a computer leaves its screens and everything pushed over them, keeping what lies under", () => {
	expect(leaveHost([host("a"), host("b"), host("a")], "b")).toEqual([host("a")]);
	expect(leaveHost([host("a")], "z")).toEqual([host("a")]);
});

const chat = (sessionId: string, state: Partial<RemoteSessionItem["record"]["state"]>) =>
	({
		hostKey: "h",
		hostLabel: "Mac",
		record: {
			sessionId,
			workspaceId: "w",
			projectId: "p",
			state: {
				execution: "idle",
				runId: null,
				needsInput: null,
				completion: null,
				completionUnread: false,
				queuedCount: 0,
				backgroundWork: false,
				...state,
			},
		},
	}) as RemoteSessionItem;

test("the Sessions tab shows the sessions waiting on you, then the running ones, leaves idle ones out, and badges the first", () => {
	const items = [
		chat("idle", {}),
		chat("running", { execution: "running" }),
		chat("unread", { completionUnread: true, completion: { outcome: "completed" } as never }),
	];
	expect(
		chatSections(items).map(({ section, items: rows }) => [
			section,
			rows.map((row) => row.record.sessionId),
		]),
	).toEqual([
		["needsYou", ["unread"]],
		["running", ["running"]],
	]);
	expect(needsYouCount(items)).toBe(1);
});

test("a session the phone saw running stays under Done once it finishes, until it runs again", () => {
	const running = [chat("a", { execution: "running" }), chat("b", {})];
	const first = settleDone(new Set(), [], running);
	expect(first.done).toEqual([]);
	const finished = [chat("a", {}), chat("b", {})];
	const second = settleDone(first.seen, first.done, finished);
	expect(second.done).toEqual(["h:a"]);
	expect(
		chatSections(finished, second.done).map(({ section, items: rows }) => [
			section,
			rows.map((row) => row.record.sessionId),
		]),
	).toEqual([["done", ["a"]]]);
	const again = settleDone(second.seen, second.done, running);
	expect(again.done).toEqual([]);
});
