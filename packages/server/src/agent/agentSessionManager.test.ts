import { afterAll, beforeAll, expect, jest, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	InMemoryCredentialStore,
	type Model,
	type ModelsRefreshResult,
} from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSettlement, ExtUiRequest } from "@thinkrail/contracts";
import {
	buildSessionSettings,
	clampThinkingForModel,
	clearQueueSession,
	createSession,
	deleteSession,
	disposeAllSessions,
	ensureSessionAttached,
	followUpSession,
	getDefaultModel,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	hasSession,
	listAvailableModels,
	listSessions,
	promptSession,
	refreshAvailableModels,
	removeQueuedSession,
	removeSession,
	removeWorkspaceSessions,
	setSessionDeletedPublisher,
	setSessionManagerFactory,
	setSessionPublisher,
	steerSession,
	toWireModel,
} from "./agentSessionManager";
import { configurePiRuntime } from "./piRuntime";
import { setTrashImplementationForTests } from "./trash";
import {
	cancelExtUiForSession,
	createWebUiContext,
	resolveExtUi,
	setExtUiPublisher,
} from "./webUiContext";

function modelDef(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

const fauxA = createFauxCore({
	provider: "fauxa",
	api: "fauxa",
	models: [modelDef("fauxa")],
	tokensPerSecond: 2000,
});
const fauxB = createFauxCore({
	provider: "fauxb",
	api: "fauxb",
	models: [modelDef("fauxb")],
	tokensPerSecond: 2000,
});
const fauxC = createFauxCore({
	provider: "fauxc",
	api: "fauxc",
	models: [modelDef("fauxc")],
	tokensPerSecond: 2000,
});

const cfg = (faux: typeof fauxA, id: string) => ({
	api: faux.api,
	baseUrl: "http://faux.local",
	apiKey: "faux",
	streamSimple: faux.streamSimple,
	models: [{ ...modelDef(id), api: faux.api }],
});

const events = new Map<string, unknown[]>();
const seen = (id: string) => JSON.stringify(events.get(id) ?? []);

const tmpDirs: string[] = [];
function tmpCwd(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
let runtime: ModelRuntime;

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmpCwd("trpi-agentdir-");

	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("fauxa", cfg(fauxA, "fauxa"));
	runtime.registerProvider("fauxb", cfg(fauxB, "fauxb"));

	configurePiRuntime(runtime);
	setSessionManagerFactory(() => SessionManager.inMemory());
	setSessionPublisher(({ sessionId, event }) => {
		const list = events.get(sessionId) ?? [];
		list.push(event);
		events.set(sessionId, list);
	});
});

afterAll(() => {
	disposeAllSessions();
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
});

test("two sessions in two worktrees stream independently; disposing one leaves the other working", async () => {
	fauxA.setResponses([fauxAssistantMessage("ALPHA_REPLY")]);
	fauxB.setResponses([fauxAssistantMessage("BRAVO_REPLY")]);

	const a = await createSession({
		cwd: tmpCwd("trpi-a-"),
		workspaceId: "ws-a",
		// biome-ignore lint/suspicious/noExplicitAny: faux Model<string> satisfies the SDK's Model<any>
		model: fauxA.getModel() as any,
	});
	const b = await createSession({
		cwd: tmpCwd("trpi-b-"),
		workspaceId: "ws-b",
		// biome-ignore lint/suspicious/noExplicitAny: see above
		model: fauxB.getModel() as any,
	});
	expect(a.sessionId).not.toBe(b.sessionId);

	await Promise.all([promptSession(a.sessionId, "hello A"), promptSession(b.sessionId, "hello B")]);

	expect(seen(a.sessionId)).toContain("ALPHA_REPLY");
	expect(seen(a.sessionId)).not.toContain("BRAVO_REPLY");
	expect(seen(b.sessionId)).toContain("BRAVO_REPLY");
	expect(seen(b.sessionId)).not.toContain("ALPHA_REPLY");

	const aEventsBefore = (events.get(a.sessionId) ?? []).length;
	removeSession(a.sessionId);
	fauxB.appendResponses([fauxAssistantMessage("BRAVO_AGAIN")]);
	await promptSession(b.sessionId, "again B");

	expect(seen(b.sessionId)).toContain("BRAVO_AGAIN");
	expect((events.get(a.sessionId) ?? []).length).toBe(aEventsBefore);
});

test("agent_settled carries the final attempt's terminal metadata", async () => {
	fauxA.setResponses([
		fauxAssistantMessage("incomplete", {
			stopReason: "length",
			errorMessage: "response truncated",
		}),
	]);
	const cwd = tmpCwd("trpi-settled-");
	const session = await createSession({
		cwd,
		workspaceId: "ws-settled",
		model: toWireModel(fauxA.getModel()),
	});

	await promptSession(session.sessionId, "hello");

	const settled = (events.get(session.sessionId) ?? []).find(
		(
			event,
		): event is Record<string, unknown> & {
			type: "agent_settled";
			terminal: AgentSettlement | null;
		} =>
			typeof event === "object" &&
			event !== null &&
			"type" in event &&
			event.type === "agent_settled",
	);
	expect(settled?.terminal).toEqual({
		stopReason: "length",
		errorMessage: "response truncated",
	});
	const hydrated = await getSessionMessages(session.sessionId, "ws-settled", cwd);
	expect(hydrated.summary.lastSettlement).toEqual(settled?.terminal);
});

test("buildSessionSettings disables image autoResize (in-memory, so the read tool sends images raw)", () => {
	expect(buildSessionSettings(tmpCwd("trpi-settings-")).getImageAutoResize()).toBe(false);
});

test("listAvailableModels returns the configured (faux) models", async () => {
	const ids = (await listAvailableModels()).map((m) => m.id);
	expect(ids).toContain("fauxa");
	expect(ids).toContain("fauxb");
});

const refreshSettled = () => new Promise<void>((r) => setTimeout(r, 0));

test("model.list is never blocked by a hanging catalog refresh (fire-and-forget, issue #98)", async () => {
	delete process.env.PI_OFFLINE;
	const originalRefresh = runtime.refresh.bind(runtime);
	let releaseHang = () => {};
	try {
		runtime.refresh = () =>
			new Promise<ModelsRefreshResult>((resolve) => {
				releaseHang = () => resolve({ aborted: false, errors: new Map() });
			});
		const ids = (await listAvailableModels()).map((m) => m.id);
		expect(ids).toContain("fauxa");
	} finally {
		releaseHang();
		await refreshSettled();
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

test("a newly-shipped catalog model appears on a later model.list without a restart (issue #98)", async () => {
	delete process.env.PI_OFFLINE;
	const originalRefresh = runtime.refresh.bind(runtime);
	let landRefresh = () => {};
	let refreshCalls = 0;
	try {
		runtime.refresh = () => {
			refreshCalls += 1;
			if (refreshCalls > 1) return Promise.resolve({ aborted: false, errors: new Map() });
			return new Promise<ModelsRefreshResult>((resolve) => {
				landRefresh = () => {
					runtime.registerProvider("fauxc", cfg(fauxC, "fauxc"));
					resolve({ aborted: false, errors: new Map() });
				};
			});
		};

		const before = (await listAvailableModels()).map((m) => m.id);
		expect(before).not.toContain("fauxc");

		landRefresh();
		await refreshSettled();

		const after = (await listAvailableModels()).map((m) => m.id);
		expect(after).toContain("fauxc");
	} finally {
		await refreshSettled();
		runtime.unregisterProvider("fauxc");
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

test("wire models expose only the allowlisted fields (no baseUrl/headers/other Model fields)", async () => {
	const models = await listAvailableModels();
	expect(models.length).toBeGreaterThan(0);
	for (const m of models) {
		expect(Object.keys(m).sort()).toEqual([
			"contextWindow",
			"id",
			"name",
			"provider",
			"reasoning",
			"thinkingLevels",
		]);
		expect(m.thinkingLevels).toEqual(["off"]);
	}
});

test("thinkingLevels is pi's per-model support truth, not a reasoning boolean widened to all seven", () => {
	const reasoner: Model<string> = {
		...modelDef("reasoner"),
		provider: "fauxa",
		api: "fauxa",
		baseUrl: "http://faux.local",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh" },
	};
	expect(toWireModel(reasoner).thinkingLevels).toEqual([
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
	]);

	const alwaysThinks: Model<string> = { ...reasoner, thinkingLevelMap: { off: null } };
	expect(toWireModel(alwaysThinks).thinkingLevels).not.toContain("off");
});

test("model.clampThinking answers with pi's clamp, not a plausible client-side policy", async () => {
	const reasoning = (id: string, map: Record<string, string | null>) => ({
		...cfg(fauxA, id),
		models: [{ ...modelDef(id), api: fauxA.api, reasoning: true, thinkingLevelMap: map }],
	});

	runtime.registerProvider("clamp5", reasoning("clamp5", { xhigh: "xhigh" }));
	runtime.registerProvider(
		"clamp2",
		reasoning("clamp2", { off: null, minimal: null, medium: null }),
	);
	try {
		expect(await clampThinkingForModel({ provider: "clamp5", id: "clamp5" }, "max")).toBe("xhigh");
		expect(await clampThinkingForModel({ provider: "clamp2", id: "clamp2" }, "off")).toBe("low");
		expect(await clampThinkingForModel({ provider: "clamp2", id: "clamp2" }, "high")).toBe("high");
	} finally {
		runtime.unregisterProvider("clamp5");
		runtime.unregisterProvider("clamp2");
	}
});

test("model.clampThinking refuses a model ref the host can't resolve", async () => {
	await expect(clampThinkingForModel({ provider: "nope", id: "nope" }, "high")).rejects.toThrow(
		/Unknown or unavailable model/,
	);
});

test("model.default clamps the saved thinking level onto the resolved model's support set", async () => {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const settingsPath = join(agentDir, "settings.json");
	writeFileSync(settingsPath, `${JSON.stringify({ defaultThinkingLevel: "high" })}\n`);
	try {
		const d = await getDefaultModel();
		expect(d.model?.thinkingLevels).toEqual(["off"]);
		expect(d.thinkingLevel).toBe("off");
	} finally {
		rmSync(settingsPath, { force: true });
	}
});

test("model.refresh serves the same redacted universe as model.list (post-refresh snapshot)", async () => {
	const [listed, refreshed] = [await listAvailableModels(), await refreshAvailableModels()];
	expect(refreshed.models).toEqual(listed);
	expect(refreshed.models.length).toBeGreaterThan(0);
	expect(refreshed.complete).toBe(true);
});

test("model.refresh WAITS for the refresh — its list already includes what the refresh landed", async () => {
	delete process.env.PI_OFFLINE;
	const originalRefresh = runtime.refresh.bind(runtime);
	try {
		runtime.refresh = () =>
			new Promise<ModelsRefreshResult>((resolve) => {
				setTimeout(() => {
					runtime.registerProvider("fauxc", cfg(fauxC, "fauxc"));
					resolve({ aborted: false, errors: new Map() });
				}, 5);
			});
		const refreshed = await refreshAvailableModels(true);
		expect(refreshed.models.map((m) => m.id)).toContain("fauxc");
		expect(refreshed.complete).toBe(true);
	} finally {
		runtime.unregisterProvider("fauxc");
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

async function armedDeadline(before: number): Promise<void> {
	for (let i = 0; i < 100 && jest.getTimerCount() <= before; i++) await Promise.resolve();
	expect(jest.getTimerCount()).toBeGreaterThan(before);
}

test("a stalled availability fan-out neither blocks a model call nor authorizes its list", async () => {
	delete process.env.PI_OFFLINE;
	const originalRefresh = runtime.refresh.bind(runtime);
	const originalGetAvailable = runtime.getAvailable.bind(runtime);
	jest.useFakeTimers();
	try {
		runtime.getAvailable = () => new Promise<never>(() => {});
		runtime.refresh = () => new Promise<never>(() => {});
		const listed = await listAvailableModels();
		expect(listed.map((m) => m.id)).toContain("fauxa");
		const pendingTimers = jest.getTimerCount();

		const refreshing = refreshAvailableModels(true);
		await armedDeadline(pendingTimers);
		jest.advanceTimersByTime(15_000);
		const refreshed = await refreshing;
		expect(refreshed.models).toEqual(listed);
		expect(refreshed.complete).toBe(false);
	} finally {
		jest.useRealTimers();
		runtime.getAvailable = originalGetAvailable;
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

test("createSession re-resolves a wire model ref by {provider,id}, never trusting a client baseUrl", async () => {
	fauxA.setResponses([fauxAssistantMessage("RESOLVED_REPLY")]);
	const ref = (await listAvailableModels()).find((m) => m.id === "fauxa");
	if (!ref) throw new Error("faux model missing");
	const s = await createSession({
		cwd: tmpCwd("trpi-resolve-"),
		workspaceId: "ws-res",
		model: ref,
	});
	await promptSession(s.sessionId, "hi");
	expect(seen(s.sessionId)).toContain("RESOLVED_REPLY");
	expect(s.model).not.toBeNull();
	expect(s.model).not.toHaveProperty("baseUrl");
	removeSession(s.sessionId);
});

test("createSession rejects an unknown/unavailable model ref (no arbitrary baseUrl injection)", async () => {
	const ref = (await listAvailableModels()).find((m) => m.id === "fauxa");
	if (!ref) throw new Error("faux model missing");
	const bogus = { ...ref, provider: "attacker", id: "evil" };
	await expect(
		createSession({ cwd: tmpCwd("trpi-bad-"), workspaceId: "ws-bad", model: bogus }),
	).rejects.toThrow(/Unknown or unavailable model/);
});

test("getSessionStats + getSessionCommands read live session info (cheap wins #3, #2)", async () => {
	fauxA.setResponses([fauxAssistantMessage("STATS_REPLY")]);
	const s = await createSession({
		cwd: tmpCwd("trpi-stats-"),
		workspaceId: "ws-s",
		// biome-ignore lint/suspicious/noExplicitAny: faux Model<string> satisfies the SDK's Model<any>
		model: fauxA.getModel() as any,
	});
	await promptSession(s.sessionId, "count me");

	const stats = getSessionStats(s.sessionId);
	expect(stats.sessionId).toBe(s.sessionId);
	expect(stats.totalMessages).toBeGreaterThan(0);
	expect(typeof stats.cost).toBe("number");
	expect(typeof stats.tokens.total).toBe("number");

	expect(Array.isArray(getSessionCommands(s.sessionId))).toBe(true);
	removeSession(s.sessionId);
});

test("listSessions reports a workspace's live sessions; getSessionMessages returns its transcript", async () => {
	fauxA.setResponses([fauxAssistantMessage("HYDRATE_REPLY")]);
	const cwd = tmpCwd("trpi-hyd-");
	const s = await createSession({
		cwd,
		workspaceId: "ws-hyd",
		// biome-ignore lint/suspicious/noExplicitAny: faux Model<string> satisfies the SDK's Model<any>
		model: fauxA.getModel() as any,
	});
	await promptSession(s.sessionId, "hello hydrate");

	const listed = await listSessions("ws-hyd", cwd);
	const live = listed.find((x) => x.sessionId === s.sessionId);
	expect(live?.workspaceId).toBe("ws-hyd");
	expect(live?.live).toBe(true);
	expect(await listSessions("ws-other", cwd)).toHaveLength(0);

	const { messages } = await getSessionMessages(s.sessionId, "ws-hyd", cwd);
	expect(messages.some((m) => m.role === "user")).toBe(true);
	expect(messages.some((m) => m.role === "assistant")).toBe(true);
	expect(messages.every((m) => ["user", "assistant", "toolResult"].includes(m.role))).toBe(true);
	removeSession(s.sessionId);
});

test("listSessions ignores a live session's transient physical rewrite but stays strict for detached files", async () => {
	const cwd = tmpCwd("trpi-live-rewrite-");
	const liveManager = SessionManager.create(cwd);
	setSessionManagerFactory(() => liveManager);
	try {
		const s = await createSession({
			cwd,
			workspaceId: "ws-live-rewrite",
			model: toWireModel(fauxA.getModel()),
		});
		const sessionFile = liveManager.getSessionFile();
		if (!sessionFile) throw new Error("disk-backed live session has no file path");
		mkdirSync(dirname(sessionFile), { recursive: true });
		writeFileSync(sessionFile, "");
		expect((await listSessions("ws-live-rewrite", cwd)).map((row) => row.sessionId)).toContain(
			s.sessionId,
		);

		removeSession(s.sessionId);
		await expect(listSessions("ws-live-rewrite", cwd)).rejects.toThrow("unreadable or malformed");
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("disk-reopen: a disposed session is re-listed from disk and re-opened with its transcript (restart survival)", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	try {
		fauxA.setResponses([fauxAssistantMessage("DISK_REPLY")]);
		const cwd = tmpCwd("trpi-disk-");
		const s = await createSession({
			cwd,
			workspaceId: "ws-disk",
			// biome-ignore lint/suspicious/noExplicitAny: faux Model<string> satisfies the SDK's Model<any>
			model: fauxA.getModel() as any,
		});
		await promptSession(s.sessionId, "persist me");
		removeSession(s.sessionId);

		const fromDisk = (await listSessions("ws-disk", cwd)).find((x) => x.sessionId === s.sessionId);
		expect(fromDisk).toBeDefined();
		expect(fromDisk?.live).toBe(false);

		const otherCwd = tmpCwd("trpi-other-");
		expect((await listSessions("ws-other", otherCwd)).map((x) => x.sessionId)).not.toContain(
			s.sessionId,
		);

		const { summary, messages } = await getSessionMessages(s.sessionId, "ws-disk", cwd);
		expect(summary.live).toBe(true);
		expect(messages.some((m) => m.role === "user")).toBe(true);
		removeSession(s.sessionId);

		const [a, b] = await Promise.all([
			getSessionMessages(s.sessionId, "ws-disk", cwd),
			getSessionMessages(s.sessionId, "ws-disk", cwd),
		]);
		expect(a.summary.live && b.summary.live).toBe(true);
		expect(
			(await listSessions("ws-disk", cwd)).filter((x) => x.sessionId === s.sessionId),
		).toHaveLength(1);
		removeSession(s.sessionId);
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("deleteSession removes an empty live chat whose reserved transcript path is not materialized", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	let trashCalls = 0;
	setTrashImplementationForTests(async () => {
		trashCalls++;
	});
	let sessionId: string | undefined;
	try {
		const cwd = tmpCwd("trpi-delete-empty-");
		const session = await createSession({
			cwd,
			workspaceId: "ws-delete-empty",
			model: toWireModel(fauxA.getModel()),
		});
		sessionId = session.sessionId;
		const info = (await SessionManager.list(cwd)).find((item) => item.id === session.sessionId);
		if (info) rmSync(info.path, { force: true });

		await deleteSession(session.sessionId, "ws-delete-empty", cwd);
		expect(hasSession(session.sessionId)).toBe(false);
		expect(trashCalls).toBe(0);
	} finally {
		if (sessionId && hasSession(sessionId)) removeSession(sessionId);
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("deleteSession tombstones its id so a stale transcript cannot reattach in this host", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	setTrashImplementationForTests(async (input) => {
		const paths = typeof input === "string" ? [input] : input;
		for (const path of paths) rmSync(path, { force: true });
	});
	try {
		fauxA.setResponses([fauxAssistantMessage("DELETE_ME")]);
		const cwd = tmpCwd("trpi-delete-");
		const session = await createSession({
			cwd,
			workspaceId: "ws-delete",
			model: toWireModel(fauxA.getModel()),
		});
		await promptSession(session.sessionId, "persist before deletion");
		const info = (await SessionManager.list(cwd)).find((item) => item.id === session.sessionId);
		if (!info) throw new Error("expected the session transcript to exist");
		const staleTranscript = readFileSync(info.path);
		writeFileSync(info.path, "temporarily malformed\n");

		await deleteSession(session.sessionId, "ws-delete", cwd);
		expect(hasSession(session.sessionId)).toBe(false);
		expect(existsSync(info.path)).toBe(false);

		writeFileSync(info.path, staleTranscript);
		await expect(getSessionMessages(session.sessionId, "ws-delete", cwd)).rejects.toThrow(
			`Unknown session: ${session.sessionId}`,
		);
		rmSync(info.path, { force: true });
	} finally {
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("a malformed detached transcript is never treated as authoritative absence", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const published: string[] = [];
	let trashCalls = 0;
	setSessionDeletedPublisher(({ sessionId }) => published.push(sessionId));
	setTrashImplementationForTests(async () => {
		trashCalls++;
	});
	let sessionId: string | undefined;
	try {
		fauxA.setResponses([fauxAssistantMessage("DETACHED_CORRUPT")]);
		const cwd = tmpCwd("trpi-delete-corrupt-");
		const session = await createSession({
			cwd,
			workspaceId: "ws-delete-corrupt",
			model: toWireModel(fauxA.getModel()),
		});
		sessionId = session.sessionId;
		await promptSession(session.sessionId, "persist before corruption");
		const info = (await SessionManager.list(cwd)).find((item) => item.id === session.sessionId);
		if (!info) throw new Error("expected the session transcript to exist");
		const transcript = readFileSync(info.path);
		removeSession(session.sessionId);
		writeFileSync(info.path, "not a pi transcript\n");

		await expect(listSessions("ws-delete-corrupt", cwd)).rejects.toThrow("unreadable or malformed");
		await expect(deleteSession(session.sessionId, "ws-delete-corrupt", cwd)).rejects.toThrow(
			"unreadable or malformed",
		);
		expect(trashCalls).toBe(0);
		expect(published).toEqual([]);
		expect(existsSync(info.path)).toBe(true);

		writeFileSync(info.path, transcript);
		const restored = await getSessionMessages(session.sessionId, "ws-delete-corrupt", cwd);
		expect(restored.summary.live).toBe(true);
	} finally {
		if (sessionId) removeSession(sessionId);
		setSessionDeletedPublisher(() => {});
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("a pending delete blocks live commands, then trash failure restores the same runtime", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	let reportTrashStarted: () => void = () => {};
	const trashStarted = new Promise<void>((resolve) => {
		reportTrashStarted = resolve;
	});
	let failTrash: () => void = () => {};
	const trashOutcome = new Promise<void>((_resolve, reject) => {
		failTrash = () => reject(new Error("recycle bin unavailable"));
	});
	setTrashImplementationForTests(async () => {
		reportTrashStarted();
		await trashOutcome;
	});
	let sessionId: string | undefined;
	let deleting: Promise<void> | undefined;
	try {
		fauxA.setResponses([fauxAssistantMessage("STILL_HERE")]);
		const cwd = tmpCwd("trpi-delete-failure-");
		const session = await createSession({
			cwd,
			workspaceId: "ws-delete-failure",
			model: toWireModel(fauxA.getModel()),
		});
		sessionId = session.sessionId;
		await promptSession(session.sessionId, "persist before failed deletion");
		const info = (await SessionManager.list(cwd)).find((item) => item.id === session.sessionId);
		if (!info) throw new Error("expected the session transcript to exist");

		deleting = deleteSession(session.sessionId, "ws-delete-failure", cwd);
		await trashStarted;
		expect(hasSession(session.sessionId)).toBe(false);
		await expect(promptSession(session.sessionId, "must not be accepted")).rejects.toThrow(
			`Unknown session: ${session.sessionId}`,
		);
		expect(() => removeSession(session.sessionId)).toThrow(`Unknown session: ${session.sessionId}`);
		expect(readFileSync(info.path, "utf8")).not.toContain("must not be accepted");

		failTrash();
		await expect(deleting).rejects.toThrow("recycle bin unavailable");
		expect(hasSession(session.sessionId)).toBe(true);
		expect(readFileSync(info.path, "utf8")).toContain("persist before failed deletion");
		const restored = await getSessionMessages(session.sessionId, "ws-delete-failure", cwd);
		expect(restored.summary.live).toBe(true);
		expect(restored.messages.some((message) => message.role === "assistant")).toBe(true);

		fauxA.appendResponses([fauxAssistantMessage("AFTER_ROLLBACK")]);
		await promptSession(session.sessionId, "accepted after rollback");
		expect(readFileSync(info.path, "utf8")).toContain("accepted after rollback");
	} finally {
		failTrash();
		await deleting?.catch(() => {});
		if (sessionId && hasSession(sessionId)) removeSession(sessionId);
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("concurrent deletes of one chat coalesce into a single owned transaction", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	let trashCalls = 0;
	let reportTrashStarted: () => void = () => {};
	const trashStarted = new Promise<void>((resolve) => {
		reportTrashStarted = resolve;
	});
	let failTrash: () => void = () => {};
	const trashOutcome = new Promise<void>((_resolve, reject) => {
		failTrash = () => reject(new Error("recycle bin unavailable"));
	});
	setTrashImplementationForTests(async () => {
		trashCalls++;
		reportTrashStarted();
		await trashOutcome;
	});
	let sessionId: string | undefined;
	let first: Promise<void> | undefined;
	let second: Promise<void> | undefined;
	try {
		fauxA.setResponses([fauxAssistantMessage("COALESCE_ME")]);
		const cwd = tmpCwd("trpi-delete-coalesce-");
		const session = await createSession({
			cwd,
			workspaceId: "ws-delete-coalesce",
			model: toWireModel(fauxA.getModel()),
		});
		sessionId = session.sessionId;
		await promptSession(session.sessionId, "persist before concurrent delete");
		const info = (await SessionManager.list(cwd)).find((item) => item.id === session.sessionId);
		if (!info) throw new Error("expected the session transcript to exist");

		first = deleteSession(session.sessionId, "ws-delete-coalesce", cwd);
		second = deleteSession(session.sessionId, "ws-delete-coalesce", cwd);
		await trashStarted;
		expect(trashCalls).toBe(1);

		await expect(promptSession(session.sessionId, "must not be accepted")).rejects.toThrow(
			`Unknown session: ${session.sessionId}`,
		);

		failTrash();
		await expect(first).rejects.toThrow("recycle bin unavailable");
		await expect(second).rejects.toThrow("recycle bin unavailable");
		expect(hasSession(session.sessionId)).toBe(true);
		expect(readFileSync(info.path, "utf8")).toContain("persist before concurrent delete");
		expect(readFileSync(info.path, "utf8")).not.toContain("must not be accepted");
		fauxA.appendResponses([fauxAssistantMessage("AFTER_ROLLBACK")]);
		await promptSession(session.sessionId, "accepted after rollback");
		expect(readFileSync(info.path, "utf8")).toContain("accepted after rollback");
	} finally {
		failTrash();
		await Promise.allSettled([first, second]);
		if (sessionId && hasSession(sessionId)) removeSession(sessionId);
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("archival teardown is not blocked by a chat whose recoverable delete is mid-trash", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	let reportTrashStarted: () => void = () => {};
	const trashStarted = new Promise<void>((resolve) => {
		reportTrashStarted = resolve;
	});
	let failTrash: () => void = () => {};
	const trashOutcome = new Promise<void>((_resolve, reject) => {
		failTrash = () => reject(new Error("recycle bin unavailable"));
	});
	setTrashImplementationForTests(async () => {
		reportTrashStarted();
		await trashOutcome;
	});
	let deleting: Promise<void> | undefined;
	try {
		fauxA.setResponses([fauxAssistantMessage("ARCHIVE_DURING_DELETE")]);
		const cwd = tmpCwd("trpi-archive-during-delete-");
		const doomed = await createSession({
			cwd,
			workspaceId: "ws-archive-during-delete",
			model: toWireModel(fauxA.getModel()),
		});
		await promptSession(doomed.sessionId, "persist before archive");
		const info = (await SessionManager.list(cwd)).find((item) => item.id === doomed.sessionId);
		if (!info) throw new Error("expected the session transcript to exist");

		deleting = deleteSession(doomed.sessionId, "ws-archive-during-delete", cwd);
		await trashStarted;

		await removeWorkspaceSessions("ws-archive-during-delete", cwd);
		expect(hasSession(doomed.sessionId)).toBe(false);
		expect(existsSync(info.path)).toBe(false);
	} finally {
		failTrash();
		await deleting?.catch(() => {});
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("ensureSessionAttached: a detached-but-persisted session comes back live; a missing id is `false`", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	try {
		fauxA.setResponses([fauxAssistantMessage("REVIEW_CHAT")]);
		const cwd = tmpCwd("trpi-reattach-");
		const s = await createSession({
			cwd,
			workspaceId: "ws-reattach",
			model: toWireModel(fauxA.getModel()),
		});
		await promptSession(s.sessionId, "the review package");
		removeSession(s.sessionId);
		expect(hasSession(s.sessionId)).toBe(false);

		expect(await ensureSessionAttached(s.sessionId, "ws-reattach", cwd)).toBe(true);
		expect(hasSession(s.sessionId)).toBe(true);
		expect(await ensureSessionAttached(s.sessionId, "ws-reattach", cwd)).toBe(true);

		expect(await ensureSessionAttached("no-such-session", "ws-reattach", cwd)).toBe(false);
		removeSession(s.sessionId);
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("followUpSession on an IDLE session runs the turn — pi's follow-up queue has nothing to drain it", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	try {
		fauxA.setResponses([fauxAssistantMessage("FIRST_BATCH")]);
		const cwd = tmpCwd("trpi-followup-");
		const s = await createSession({
			cwd,
			workspaceId: "ws-followup",
			model: toWireModel(fauxA.getModel()),
		});
		await promptSession(s.sessionId, "batch one");
		removeSession(s.sessionId);
		expect(await ensureSessionAttached(s.sessionId, "ws-followup", cwd)).toBe(true);

		fauxA.appendResponses([fauxAssistantMessage("SECOND_BATCH")]);
		await followUpSession(s.sessionId, "batch two");
		expect(seen(s.sessionId)).toContain("SECOND_BATCH");
		removeSession(s.sessionId);
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("mid-stream followUpSession queues: the summary snapshot carries it, clearQueueSession hands it back", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const slow = createFauxCore({
		provider: "fauxq",
		api: "fauxq",
		models: [modelDef("fauxq")],
		tokensPerSecond: 40,
	});
	runtime.registerProvider("fauxq", cfg(slow, "fauxq"));
	try {
		slow.setResponses([fauxAssistantMessage(`SLOW_TURN ${"word ".repeat(80)}END`)]);
		const cwd = tmpCwd("trpi-queue-");
		const s = await createSession({
			cwd,
			workspaceId: "ws-queue",
			model: toWireModel(slow.getModel()),
		});
		const turn = promptSession(s.sessionId, "stream slowly");
		turn.catch(() => {});
		const deadline = Date.now() + 5000;
		while (!seen(s.sessionId).includes("message_update")) {
			if (Date.now() > deadline) throw new Error("first turn never started streaming");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		await followUpSession(s.sessionId, "queued line");
		await followUpSession(s.sessionId, "queued line two");

		const summary = (await listSessions("ws-queue", cwd)).find(
			(row) => row.sessionId === s.sessionId,
		);
		expect(summary?.queue).toEqual({
			steering: [],
			followUp: ["queued line", "queued line two"],
		});
		expect(seen(s.sessionId)).toContain("queue_update");

		expect(await removeQueuedSession(s.sessionId, "followUp", 5)).toEqual({
			removed: null,
			queue: { steering: [], followUp: ["queued line", "queued line two"] },
		});
		expect(await removeQueuedSession(s.sessionId, "followUp", 0)).toEqual({
			removed: "queued line",
			queue: { steering: [], followUp: ["queued line two"] },
		});

		expect(clearQueueSession(s.sessionId)).toEqual({ steering: [], followUp: ["queued line two"] });
		expect(clearQueueSession(s.sessionId)).toEqual({ steering: [], followUp: [] });

		await turn;
		removeSession(s.sessionId);
	} finally {
		runtime.unregisterProvider("fauxq");
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
}, 20000);

test("removeQueuedSession on an idle session never strands the keepers — they deliver via the idle fallback", async () => {
	fauxA.setResponses([fauxAssistantMessage("PARKED_DELIVERED")]);
	const s = await createSession({
		cwd: tmpCwd("trpi-remove-idle-"),
		workspaceId: "ws-remove-idle",
		model: toWireModel(fauxA.getModel()),
	});
	await steerSession(s.sessionId, "parked one");
	await steerSession(s.sessionId, "parked two");

	const result = await removeQueuedSession(s.sessionId, "steering", 0);
	expect(result.removed).toBe("parked one");
	expect(result.queue).toEqual({ steering: [], followUp: [] });
	expect(seen(s.sessionId)).toContain("PARKED_DELIVERED");
	removeSession(s.sessionId);
});

test("removeWorkspaceSessions: archives a workspace's live sessions + purges their on-disk transcripts, leaving siblings", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	try {
		fauxA.setResponses([fauxAssistantMessage("ARCHIVE_ME")]);
		fauxB.setResponses([fauxAssistantMessage("KEEP_ME")]);
		const doomedCwd = tmpCwd("trpi-arch-");
		const doomed = await createSession({
			cwd: doomedCwd,
			workspaceId: "ws-doomed",
			// biome-ignore lint/suspicious/noExplicitAny: faux Model<string> satisfies the SDK's Model<any>
			model: fauxA.getModel() as any,
		});
		const keepCwd = tmpCwd("trpi-arch-keep-");
		const survivor = await createSession({
			cwd: keepCwd,
			workspaceId: "ws-keep",
			// biome-ignore lint/suspicious/noExplicitAny: see above
			model: fauxB.getModel() as any,
		});
		await Promise.all([
			promptSession(doomed.sessionId, "persist doomed"),
			promptSession(survivor.sessionId, "persist survivor"),
		]);

		expect(await listSessions("ws-doomed", doomedCwd)).toHaveLength(1);
		expect(await listSessions("ws-keep", keepCwd)).toHaveLength(1);

		await removeWorkspaceSessions("ws-doomed", doomedCwd);

		expect(hasSession(doomed.sessionId)).toBe(false);
		expect(await listSessions("ws-doomed", doomedCwd)).toHaveLength(0);
		expect(hasSession(survivor.sessionId)).toBe(true);
		expect(await listSessions("ws-keep", keepCwd)).toHaveLength(1);
		removeSession(survivor.sessionId);
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("extension-UI bridge: confirm round-trips, a cancel resolves undefined, dispose dismisses", async () => {
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((f) => frames.push(f));
	const lastFrame = (): ExtUiRequest => {
		const f = frames.at(-1);
		if (!f) throw new Error("expected an ext-ui frame to have been pushed");
		return f;
	};
	const ui = createWebUiContext("sess-extui");

	const confirmP = ui.confirm("Proceed?", "Apply the change?");
	const confirmFrame = lastFrame();
	expect(confirmFrame.kind).toBe("confirm");
	expect(confirmFrame.sessionId).toBe("sess-extui");
	resolveExtUi({ id: confirmFrame.id, value: true });
	expect(await confirmP).toBe(true);

	const selectP = ui.select("Pick one", ["a", "b"]);
	resolveExtUi({ id: lastFrame().id, value: null });
	expect(await selectP).toBeUndefined();

	const inputP = ui.input("Name?");
	const inputFrame = lastFrame();
	cancelExtUiForSession("sess-extui");
	expect(await inputP).toBeUndefined();
	expect(frames.some((f) => f.kind === "dismiss" && f.id === inputFrame.id)).toBe(true);

	setExtUiPublisher(() => {});
});
