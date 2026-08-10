import { expect, test } from "bun:test";
import type { WorkspaceWatchReadyResult } from "@thinkrail/contracts";
import { createSkillLoadRequests } from "./skillLoad";

test("skill-load requests share startup, fold the replay fallback before the baseline, and guard every load", async () => {
	let resolveReady: (result: WorkspaceWatchReadyResult) => void = () => {};
	const firstReady = new Promise<WorkspaceWatchReadyResult>((resolve) => {
		resolveReady = resolve;
	});
	let watchCalls = 0;
	let tick = 0;
	const order: string[] = [];
	const requests = createSkillLoadRequests({
		watchReady: () => {
			watchCalls += 1;
			return watchCalls === 1 ? firstReady : Promise.resolve({ startupNudge: false });
		},
		noteFsChanged: () => {
			order.push("fallback");
			tick += 1;
		},
		workspaceTick: () => {
			order.push("baseline");
			return tick;
		},
		createSession: async () => {
			order.push("create");
			// A later real event remains newer than the already-captured baseline.
			tick += 1;
			return { sessionId: "created", model: null, thinkingLevel: "medium" };
		},
		getSessionMessages: async ({ sessionId, workspaceId }) => {
			order.push("messages");
			return {
				summary: {
					sessionId,
					workspaceId,
					title: "Chat",
					model: null,
					thinkingLevel: "medium",
					isStreaming: false,
					messageCount: 0,
					updatedAt: 1,
					live: false,
				},
				messages: [],
			};
		},
		reloadSessionResources: async () => {
			order.push("reload");
			return { ok: true };
		},
	});

	const creating = requests.createSession({ workspaceId: "ws1" });
	const reading = requests.getSessionMessages({ workspaceId: "ws1", sessionId: "disk" });
	expect(watchCalls).toBe(1);
	expect(order).toEqual([]);

	resolveReady({ startupNudge: true });
	const [created, messages] = await Promise.all([creating, reading]);
	expect(created.syncedTick).toBe(1);
	expect(messages.syncedTick).toBe(1);
	expect(order.slice(0, 2)).toEqual(["fallback", "baseline"]);
	expect(order.filter((step) => step === "fallback")).toHaveLength(1);
	expect(order).toContain("create");
	expect(order).toContain("messages");
	expect(tick).toBe(2);

	const reloaded = await requests.reloadSessionResources("ws1", { sessionId: "created" });
	expect(watchCalls).toBe(2);
	expect(reloaded.syncedTick).toBe(2);
	expect(order.filter((step) => step === "fallback")).toHaveLength(1);
	expect(order.at(-1)).toBe("reload");
});
