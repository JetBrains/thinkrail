import { expect, test } from "bun:test";
import type { WorkspaceFsChangedPayload, WorkspaceWatchReadyResult } from "@thinkrail/contracts";
import { createSkillLoadRequests } from "./skillLoad";

test("session-message loads reject a response for a different workspace or session", async () => {
	let requestedMismatch: "workspace" | "session" = "workspace";
	const requests = createSkillLoadRequests({
		watchReady: async () => ({ startupNudge: false }),
		noteFsChanged: () => {},
		workspaceTick: () => 0,
		createSession: async () => ({ sessionId: "created", model: null, thinkingLevel: "medium" }),
		getSessionMessages: async () => ({
			summary: {
				sessionId: requestedMismatch === "session" ? "other-session" : "requested-session",
				workspaceId: requestedMismatch === "workspace" ? "other-workspace" : "requested-workspace",
				title: "Chat",
				model: null,
				thinkingLevel: "medium",
				isStreaming: false,
				messageCount: 0,
				updatedAt: 1,
				live: false,
			},
			messages: [],
		}),
		reloadSessionResources: async () => ({ ok: true }),
	});
	const params = { workspaceId: "requested-workspace", sessionId: "requested-session" };
	await expect(requests.getSessionMessages(params)).rejects.toThrow(
		"Session response did not match the requested workspace and session",
	);
	requestedMismatch = "session";
	await expect(requests.getSessionMessages(params)).rejects.toThrow(
		"Session response did not match the requested workspace and session",
	);
});

test("resource loads share startup, fold the replay fallback before the baseline, and wait for readiness", async () => {
	let resolveReady: (result: WorkspaceWatchReadyResult) => void = () => {};
	const firstReady = new Promise<WorkspaceWatchReadyResult>((resolve) => {
		resolveReady = resolve;
	});
	let watchCalls = 0;
	let tick = 0;
	const order: string[] = [];
	const fallbacks: WorkspaceFsChangedPayload[] = [];
	const requests = createSkillLoadRequests({
		watchReady: () => {
			watchCalls += 1;
			return watchCalls === 1 ? firstReady : Promise.resolve({ startupNudge: false });
		},
		noteFsChanged: (payload) => {
			order.push("fallback");
			fallbacks.push(payload);
			tick += 1;
		},
		workspaceTick: () => {
			order.push("baseline");
			return tick;
		},
		createSession: async () => {
			order.push("create");
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
	expect(watchCalls).toBe(1);
	expect(order).toEqual([]);

	resolveReady({ startupNudge: true });
	const created = await creating;
	expect(created.syncedTick).toBe(1);
	expect(order).toEqual(["fallback", "baseline", "create"]);
	expect(fallbacks).toEqual([
		{ workspaceId: "ws1", paths: [], truncated: true, skillChange: "unknown" },
	]);
	expect(tick).toBe(2);

	const reloaded = await requests.reloadSessionResources("ws1", { sessionId: "created" });
	expect(watchCalls).toBe(2);
	expect(reloaded.syncedTick).toBe(2);
	expect(order.filter((step) => step === "fallback")).toHaveLength(1);
	expect(order.at(-1)).toBe("reload");
});

test("a prewarm-started preparation never becomes a real load's baseline: the first real load re-prepares with the real flag", async () => {
	let resolvePrewarm: (result: WorkspaceWatchReadyResult) => void = () => {};
	const prewarmReady = new Promise<WorkspaceWatchReadyResult>((resolve) => {
		resolvePrewarm = resolve;
	});
	let resolveReal: (result: WorkspaceWatchReadyResult) => void = () => {};
	const realReady = new Promise<WorkspaceWatchReadyResult>((resolve) => {
		resolveReal = resolve;
	});
	const watchCalls: boolean[] = [];
	const requests = createSkillLoadRequests({
		watchReady: (_workspaceId, prewarm) => {
			watchCalls.push(prewarm);
			if (watchCalls.length > 2) return Promise.resolve({ startupNudge: false });
			return prewarm ? prewarmReady : realReady;
		},
		noteFsChanged: () => {},
		workspaceTick: () => 3,
		createSession: async () => ({ sessionId: "created", model: null, thinkingLevel: "medium" }),
		getSessionMessages: async ({ sessionId, workspaceId }) => ({
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
		}),
		reloadSessionResources: async () => ({ ok: true }),
	});

	const prewarming = requests.prewarmWorkspaceSkillLoad("ws1");
	const prewarmingAgain = requests.prewarmWorkspaceSkillLoad("ws1");
	expect(watchCalls).toEqual([true]);

	const creating = requests.createSession({ workspaceId: "ws1" });
	expect(watchCalls).toEqual([true, false]);

	const prewarmingDuringReal = requests.prewarmWorkspaceSkillLoad("ws1");
	expect(watchCalls).toEqual([true, false]);

	resolvePrewarm({ startupNudge: true });
	resolveReal({ startupNudge: false });
	const [created] = await Promise.all([
		creating,
		prewarming,
		prewarmingAgain,
		prewarmingDuringReal,
	]);
	expect(created.syncedTick).toBe(3);

	await requests.prewarmWorkspaceSkillLoad("ws1");
	expect(watchCalls).toEqual([true, false, true]);
});

test("a failed prewarm leaves the eventual session load able to retry preparation", async () => {
	const watchCalls: boolean[] = [];
	const requests = createSkillLoadRequests({
		watchReady: async (_workspaceId, prewarm) => {
			watchCalls.push(prewarm);
			if (prewarm) throw new Error("watch failed");
			return { startupNudge: false };
		},
		noteFsChanged: () => {},
		workspaceTick: () => 7,
		createSession: async () => ({ sessionId: "created", model: null, thinkingLevel: "medium" }),
		getSessionMessages: async ({ sessionId, workspaceId }) => ({
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
		}),
		reloadSessionResources: async () => ({ ok: true }),
	});

	await expect(requests.prewarmWorkspaceSkillLoad("ws1")).rejects.toThrow("watch failed");
	const loaded = await requests.getSessionMessages({ workspaceId: "ws1", sessionId: "disk" });
	expect(watchCalls).toEqual([true, false]);
	expect(loaded.syncedTick).toBe(7);
});

test("a transcript read starts the shared preparation but never waits for watcher readiness", async () => {
	let resolveReady: (result: WorkspaceWatchReadyResult) => void = () => {};
	const ready = new Promise<WorkspaceWatchReadyResult>((resolve) => {
		resolveReady = resolve;
	});
	let tick = 5;
	const order: string[] = [];
	const requests = createSkillLoadRequests({
		watchReady: () => {
			order.push("watchReady");
			return ready;
		},
		noteFsChanged: () => {
			order.push("fallback");
			tick += 1;
		},
		workspaceTick: () => tick,
		createSession: async () => {
			order.push("create");
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
					live: true,
				},
				messages: [],
			};
		},
		reloadSessionResources: async () => ({ ok: true }),
	});

	const read = await requests.getSessionMessages({ workspaceId: "ws1", sessionId: "disk" });
	expect(read.syncedTick).toBe(5);
	expect(order).toEqual(["watchReady", "messages"]);

	const creating = requests.createSession({ workspaceId: "ws1" });
	expect(order).toEqual(["watchReady", "messages"]);
	resolveReady({ startupNudge: true });
	expect((await creating).syncedTick).toBe(6);
	expect(order).toEqual(["watchReady", "messages", "fallback", "create"]);
});
