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
import type {
	AgentSettlement,
	ExtUiRequest,
	ImageContent,
	SessionSummary,
} from "@thinkrail/contracts";
import {
	abortSession,
	buildSessionSettings,
	clampThinkingForModel,
	clearQueueSession,
	compactSession,
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
	liveParentSessionForDelegation,
	promptSession,
	refreshAvailableModels,
	reloadSessionResources,
	removeQueuedSession,
	removeSession,
	removeWorkspaceSessions,
	resetSessionAdmissionForTests,
	setSessionCreatedPublisher,
	setSessionDeletedPublisher,
	setSessionManagerFactory,
	setSessionPublisher,
	settleSessionsForShutdown,
	steerSession,
	toWireModel,
} from "./agentSessionManager";
import { configurePiRuntime } from "./piRuntime";
import { setTrashImplementationForTests } from "./trash";
import { setExtUiPublisher } from "./webUiContext";

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

test("session creation publishes a domain summary for other frontends", async () => {
	const published: SessionSummary[] = [];
	setSessionCreatedPublisher((summary) => published.push(summary));
	try {
		const created = await createSession({
			cwd: tmpCwd("trpi-created-push-"),
			workspaceId: "ws-created-push",
			model: toWireModel(fauxA.getModel()),
		});
		expect(published).toHaveLength(1);
		expect(published[0]).toMatchObject({
			sessionId: created.sessionId,
			workspaceId: "ws-created-push",
			title: "Chat",
			live: true,
		});
		removeSession(created.sessionId);
	} finally {
		setSessionCreatedPublisher(() => {});
	}
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

test("buildSessionSettings disables image autoResize (in-memory, so the read tool sends images raw)", async () => {
	const settings = buildSessionSettings(tmpCwd("trpi-settings-"));
	expect(settings.getImageAutoResize()).toBe(false);
	await settings.reload();
	expect(settings.getImageAutoResize()).toBe(false);
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
		await removeSession(s.sessionId);

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
		await removeSession(s.sessionId);

		const [a, b] = await Promise.all([
			getSessionMessages(s.sessionId, "ws-disk", cwd),
			getSessionMessages(s.sessionId, "ws-disk", cwd),
		]);
		expect(a.summary.live && b.summary.live).toBe(true);
		expect(
			(await listSessions("ws-disk", cwd)).filter((x) => x.sessionId === s.sessionId),
		).toHaveLength(1);
		await removeSession(s.sessionId);
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("a foreign delete cannot fence an owner's in-flight disk attachment", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const extensionsDir = join(agentDir, "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	const extensionPath = join(extensionsDir, "attach-gate.ts");
	const gateDir = tmpCwd("trpi-attach-gate-");
	const startedPath = join(gateDir, "started");
	const releasePath = join(gateDir, "release");
	let sessionId: string | undefined;
	let reopening: ReturnType<typeof getSessionMessages> | undefined;
	try {
		fauxA.setResponses([fauxAssistantMessage("ATTACH_ME")]);
		const cwd = tmpCwd("trpi-attach-owner-");
		const session = await createSession({
			cwd,
			workspaceId: "ws-attach-owner",
			model: toWireModel(fauxA.getModel()),
		});
		sessionId = session.sessionId;
		await promptSession(sessionId, "persist before attachment");
		await removeSession(sessionId);
		writeFileSync(
			extensionPath,
			[
				'import { existsSync, writeFileSync } from "node:fs";',
				'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
				"export default function (pi: ExtensionAPI) {",
				'\tpi.on("session_start", async () => {',
				`\t\twriteFileSync(${JSON.stringify(startedPath)}, "started");`,
				`\t\twhile (!existsSync(${JSON.stringify(releasePath)})) await new Promise((resolve) => setTimeout(resolve, 10));`,
				"\t});",
				"}",
				"",
			].join("\n"),
		);

		reopening = getSessionMessages(sessionId, "ws-attach-owner", cwd);
		const deadline = Date.now() + 5_000;
		while (!existsSync(startedPath)) {
			if (Date.now() > deadline) throw new Error("disk attachment did not reach session_start");
			await Bun.sleep(10);
		}
		const foreignDelete = deleteSession(
			sessionId,
			"ws-attach-foreign",
			tmpCwd("trpi-attach-foreign-"),
		).then(
			() => ({ status: "resolved" as const }),
			(error: unknown) => ({
				status: "rejected" as const,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		const outcome = await Promise.race([
			foreignDelete,
			new Promise<{ status: "pending" }>((resolve) =>
				setTimeout(() => resolve({ status: "pending" }), 250),
			),
		]);
		expect(outcome).toEqual({
			status: "rejected",
			message: `Unknown session: ${sessionId}`,
		});

		writeFileSync(releasePath, "release");
		const restored = await reopening;
		expect(restored.summary.sessionId).toBe(sessionId);
		expect(hasSession(sessionId)).toBe(true);
	} finally {
		writeFileSync(releasePath, "release");
		await reopening?.catch(() => {});
		if (sessionId && hasSession(sessionId)) await removeSession(sessionId);
		rmSync(extensionPath, { force: true });
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("workspace archival fences and drains an in-flight disk attachment before purging transcripts", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const extensionsDir = join(agentDir, "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	const extensionPath = join(extensionsDir, "archive-attach-gate.ts");
	const gateDir = tmpCwd("trpi-archive-attach-gate-");
	const startedPath = join(gateDir, "started");
	const releasePath = join(gateDir, "release");
	let reopening: ReturnType<typeof getSessionMessages> | undefined;
	let archiving: Promise<void> | undefined;
	try {
		fauxA.setResponses([fauxAssistantMessage("ARCHIVE_ATTACH")]);
		const cwd = tmpCwd("trpi-archive-attach-");
		const created = await createSession({
			cwd,
			workspaceId: "ws-archive-attach",
			model: toWireModel(fauxA.getModel()),
		});
		await promptSession(created.sessionId, "persist before archive");
		const info = (await SessionManager.list(cwd)).find(
			(candidate) => candidate.id === created.sessionId,
		);
		if (!info) throw new Error("persisted session missing");
		await removeSession(created.sessionId);
		writeFileSync(
			extensionPath,
			[
				'import { existsSync, writeFileSync } from "node:fs";',
				'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
				"export default function (pi: ExtensionAPI) {",
				'\tpi.on("session_start", async () => {',
				`\t\twriteFileSync(${JSON.stringify(startedPath)}, "started");`,
				`\t\twhile (!existsSync(${JSON.stringify(releasePath)})) await new Promise((resolve) => setTimeout(resolve, 10));`,
				"\t});",
				"}",
				"",
			].join("\n"),
		);

		reopening = getSessionMessages(created.sessionId, "ws-archive-attach", cwd);
		const deadline = Date.now() + 5_000;
		while (!existsSync(startedPath)) {
			if (Date.now() > deadline) throw new Error("disk attachment did not reach session_start");
			await Bun.sleep(10);
		}
		archiving = removeWorkspaceSessions("ws-archive-attach", cwd);
		expect(
			await Promise.race([
				archiving.then(() => "archived" as const),
				Bun.sleep(100).then(() => "pending" as const),
			]),
		).toBe("pending");
		writeFileSync(releasePath, "release");
		await expect(reopening).rejects.toThrow("Unknown workspace: ws-archive-attach");
		await archiving;
		expect(hasSession(created.sessionId)).toBe(false);
		expect(existsSync(info.path)).toBe(false);
	} finally {
		writeFileSync(releasePath, "release");
		await reopening?.catch(() => {});
		await archiving?.catch(() => {});
		rmSync(extensionPath, { force: true });
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("shutdown admission rejects a session still assembling after the settlement snapshot", async () => {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const extensionsDir = join(agentDir, "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	const extensionPath = join(extensionsDir, "shutdown-create-gate.ts");
	const gateDir = tmpCwd("trpi-shutdown-create-gate-");
	const startedPath = join(gateDir, "started");
	const releasePath = join(gateDir, "release");
	let creating: ReturnType<typeof createSession> | undefined;
	let settling: Promise<void> | undefined;
	const published: SessionSummary[] = [];
	setSessionCreatedPublisher((summary) => published.push(summary));
	try {
		writeFileSync(
			extensionPath,
			[
				'import { existsSync, writeFileSync } from "node:fs";',
				'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
				"export default function (pi: ExtensionAPI) {",
				'\tpi.on("session_start", async () => {',
				`\t\twriteFileSync(${JSON.stringify(startedPath)}, "started");`,
				`\t\twhile (!existsSync(${JSON.stringify(releasePath)})) await new Promise((resolve) => setTimeout(resolve, 10));`,
				"\t});",
				"}",
				"",
			].join("\n"),
		);
		creating = createSession({
			cwd: tmpCwd("trpi-shutdown-create-"),
			workspaceId: "ws-shutdown-create",
			model: toWireModel(fauxA.getModel()),
		});
		const deadline = Date.now() + 5_000;
		while (!existsSync(startedPath)) {
			if (Date.now() > deadline) throw new Error("session creation did not reach session_start");
			await Bun.sleep(10);
		}
		settling = settleSessionsForShutdown(10_000);
		writeFileSync(releasePath, "release");
		await expect(creating).rejects.toThrow("Server is shutting down");
		await settling;
		expect(() =>
			createSession({
				cwd: tmpCwd("trpi-shutdown-late-create-"),
				workspaceId: "ws-shutdown-late-create",
			}),
		).toThrow("Server is shutting down");
		expect(published).toHaveLength(0);
	} finally {
		writeFileSync(releasePath, "release");
		await creating?.catch(() => {});
		await settling?.catch(() => {});
		resetSessionAdmissionForTests();
		rmSync(extensionPath, { force: true });
		setSessionCreatedPublisher(() => {});
	}
});

test("shutdown admission covers ensureSessionAttached's strict disk preflight", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	let releaseList = () => {};
	let ensuring: ReturnType<typeof ensureSessionAttached> | undefined;
	let settling: Promise<void> | undefined;
	const originalList = SessionManager.list.bind(SessionManager);
	try {
		const cwd = tmpCwd("trpi-shutdown-ensure-");
		const missingSessionId = "missing-shutdown-session";
		let markListStarted = () => {};
		const listStarted = new Promise<void>((resolve) => {
			markListStarted = resolve;
		});
		const listGate = new Promise<void>((resolve) => {
			releaseList = resolve;
		});
		Reflect.set(SessionManager, "list", async (...args: Parameters<typeof SessionManager.list>) => {
			markListStarted();
			await listGate;
			return originalList(...args);
		});

		ensuring = ensureSessionAttached(missingSessionId, "ws-shutdown-ensure", cwd);
		await listStarted;
		settling = settleSessionsForShutdown(10_000);
		expect(
			await Promise.race([
				settling.then(() => "settled" as const),
				Bun.sleep(100).then(() => "pending" as const),
			]),
		).toBe("pending");
		releaseList();
		await expect(ensuring).rejects.toThrow("Server is shutting down");
		await settling;
		expect(hasSession(missingSessionId)).toBe(false);
	} finally {
		releaseList();
		await ensuring?.catch(() => {});
		await settling?.catch(() => {});
		resetSessionAdmissionForTests();
		Reflect.set(SessionManager, "list", originalList);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("a disposal flight blocks re-attachment and makes deletion wait for resource reload", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	let releaseReload = () => {};
	let reloading: Promise<void> | undefined;
	let disposing: Promise<void> | undefined;
	let deleting: Promise<void> | undefined;
	let sessionId: string | undefined;
	let reloadReleased = false;
	let disposedBeforeRelease = false;
	try {
		fauxA.setResponses([fauxAssistantMessage("RELOAD_DELETE")]);
		const cwd = tmpCwd("trpi-reload-delete-");
		const created = await createSession({
			cwd,
			workspaceId: "ws-reload-delete",
			model: toWireModel(fauxA.getModel()),
		});
		sessionId = created.sessionId;
		await promptSession(sessionId, "persist before reload delete");
		const session = liveParentSessionForDelegation(sessionId, "ws-reload-delete");
		if (!session) throw new Error("live session missing");
		const originalReload = session.reload.bind(session);
		const originalDispose = session.dispose.bind(session);
		let markReloadStarted = () => {};
		const reloadStarted = new Promise<void>((resolve) => {
			markReloadStarted = resolve;
		});
		const reloadGate = new Promise<void>((resolve) => {
			releaseReload = () => {
				reloadReleased = true;
				resolve();
			};
		});
		Reflect.set(session, "reload", async () => {
			markReloadStarted();
			await reloadGate;
			await originalReload();
		});
		Reflect.set(session, "dispose", () => {
			if (!reloadReleased) disposedBeforeRelease = true;
			originalDispose();
		});
		setTrashImplementationForTests(async (path) => {
			for (const item of typeof path === "string" ? [path] : path) rmSync(item, { force: true });
		});

		reloading = reloadSessionResources(sessionId);
		expect(reloadSessionResources(sessionId)).toBe(reloading);
		await reloadStarted;
		disposing = removeSession(sessionId);
		await expect(getSessionMessages(sessionId, "ws-reload-delete", cwd)).rejects.toThrow(
			`Unknown session: ${sessionId}`,
		);
		deleting = deleteSession(sessionId, "ws-reload-delete", cwd);
		expect(
			await Promise.race([
				deleting.then(() => "deleted" as const),
				Bun.sleep(100).then(() => "pending" as const),
			]),
		).toBe("pending");
		expect(disposedBeforeRelease).toBe(false);
		releaseReload();
		await Promise.all([reloading, disposing, deleting]);
		expect(disposedBeforeRelease).toBe(false);
		expect(hasSession(sessionId)).toBe(false);
	} finally {
		releaseReload();
		await reloading?.catch(() => {});
		await disposing?.catch(() => {});
		await deleting?.catch(() => {});
		if (sessionId && hasSession(sessionId)) await removeSession(sessionId);
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("an owned disposal flight preserves empty-chat existence for concurrent deletion", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const published: unknown[] = [];
	setSessionDeletedPublisher((payload) => published.push(payload));
	let sessionId: string | undefined;
	try {
		const cwd = tmpCwd("trpi-dispose-delete-empty-");
		const created = await createSession({
			cwd,
			workspaceId: "ws-dispose-delete-empty",
			model: toWireModel(fauxA.getModel()),
		});
		sessionId = created.sessionId;
		const disposing = removeSession(sessionId);
		const deleting = deleteSession(sessionId, "ws-dispose-delete-empty", cwd);
		await Promise.all([disposing, deleting]);
		expect(hasSession(sessionId)).toBe(false);
		expect(published).toHaveLength(1);
	} finally {
		if (sessionId && hasSession(sessionId)) await removeSession(sessionId);
		setSessionDeletedPublisher(() => {});
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
		await expect(deleteSession(session.sessionId, "ws-delete-foreign", cwd)).rejects.toThrow(
			`Unknown session: ${session.sessionId}`,
		);
		await deleteSession(session.sessionId, "ws-delete", cwd);
		await expect(getSessionMessages(session.sessionId, "ws-delete", cwd)).rejects.toThrow(
			`Unknown session: ${session.sessionId}`,
		);
		rmSync(info.path, { force: true });
	} finally {
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("deleteSession rejects an unknown detached chat without publishing a deletion", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const published: string[] = [];
	setSessionDeletedPublisher(({ sessionId }) => published.push(sessionId));
	try {
		const cwd = tmpCwd("trpi-delete-unknown-");
		await expect(deleteSession("unknown-session", "ws-delete-unknown", cwd)).rejects.toThrow(
			"Unknown session: unknown-session",
		);
		expect(published).toEqual([]);
	} finally {
		setSessionDeletedPublisher(() => {});
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
		await expect(
			ensureSessionAttached(session.sessionId, "ws-delete-failure", cwd),
		).rejects.toThrow(`Unknown session: ${session.sessionId}`);
		expect(readFileSync(info.path, "utf8")).not.toContain("must not be accepted");

		failTrash();
		await expect(deleting).rejects.toThrow("recycle bin unavailable");
		expect(hasSession(session.sessionId)).toBe(true);
		expect(await ensureSessionAttached(session.sessionId, "ws-delete-failure", cwd)).toBe(true);
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

test("stop losslessly restores an image-bearing queue before aborting", async () => {
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
		const queuedImage = {
			type: "image",
			data: "AA==",
			mimeType: "image/png",
		} satisfies ImageContent;
		await followUpSession(s.sessionId, "queued line two", [queuedImage]);

		const summary = (await listSessions("ws-queue", cwd)).find(
			(row) => row.sessionId === s.sessionId,
		);
		expect(summary?.queue).toEqual({
			steering: [],
			followUp: ["queued line", "queued line two"],
			hasImages: true,
		});
		expect(seen(s.sessionId)).toContain('"type":"queue_update"');
		expect(seen(s.sessionId)).toContain('"hasImages":true');

		expect(() => clearQueueSession(s.sessionId, true)).toThrow("queued image");
		expect(
			(await listSessions("ws-queue", cwd)).find((row) => row.sessionId === s.sessionId)?.queue,
		).toEqual(summary?.queue);

		expect(await abortSession(s.sessionId, true)).toEqual({
			steering: [],
			followUp: [{ text: "queued line" }, { text: "queued line two", images: [queuedImage] }],
		});
		await turn.catch(() => {});

		expect(
			(await listSessions("ws-queue", cwd)).find((row) => row.sessionId === s.sessionId)?.queue,
		).toBeUndefined();
		const transcript = await getSessionMessages(s.sessionId, "ws-queue", cwd);
		expect(transcript.messages.filter((message) => message.role === "user")).toHaveLength(1);
		removeSession(s.sessionId);
	} finally {
		runtime.unregisterProvider("fauxq");
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
}, 20000);

test("removing one queued image message returns its complete content", async () => {
	const s = await createSession({
		cwd: tmpCwd("trpi-remove-image-"),
		workspaceId: "ws-remove-image",
		model: toWireModel(fauxA.getModel()),
	});
	const queuedImage = {
		type: "image",
		data: "AA==",
		mimeType: "image/png",
	} satisfies ImageContent;
	await steerSession(s.sessionId, "edit this", [queuedImage]);

	expect(await removeQueuedSession(s.sessionId, "steering", 0)).toEqual({
		removed: { text: "edit this", images: [queuedImage] },
		queue: { steering: [], followUp: [] },
	});
	removeSession(s.sessionId);
});

test("compactSession rejects an overlapping manual compaction", async () => {
	const slow = createFauxCore({
		provider: "faux-compact-lock",
		api: "faux-compact-lock",
		models: [modelDef("faux-compact-lock")],
		tokensPerSecond: 1000,
	});
	runtime.registerProvider("faux-compact-lock", cfg(slow, "faux-compact-lock"));
	let releaseCompaction = () => {};
	const compactionGate = new Promise<void>((resolve) => {
		releaseCompaction = resolve;
	});
	let sessionId: string | undefined;
	let firstCompaction: Promise<void> | undefined;
	let overlappingCompaction: Promise<void> | undefined;
	try {
		slow.setResponses([
			fauxAssistantMessage("seeded oldest turn"),
			fauxAssistantMessage("seeded large turn"),
			fauxAssistantMessage("seeded recent turn"),
			async () => {
				await compactionGate;
				return fauxAssistantMessage("FIRST_SUMMARY");
			},
			fauxAssistantMessage("SECOND_SUMMARY"),
		]);
		const cwd = tmpCwd("trpi-compact-lock-");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify({
				compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 4096 },
			}),
		);
		const session = await createSession({
			cwd,
			workspaceId: "ws-compact-lock",
			model: toWireModel(slow.getModel()),
		});
		sessionId = session.sessionId;
		await promptSession(sessionId, "old context");
		await promptSession(sessionId, "middle context");
		await promptSession(sessionId, "recent context");

		firstCompaction = compactSession(sessionId, "first");
		firstCompaction.catch(() => {});
		const deadline = Date.now() + 5000;
		while (!seen(sessionId).includes('"type":"compaction_start"') || slow.state.callCount < 4) {
			if (Date.now() > deadline) throw new Error("first compaction never started");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		overlappingCompaction = compactSession(sessionId, "second");
		overlappingCompaction.catch(() => {});
		const overlapOutcome = await Promise.race([
			overlappingCompaction.then(
				() => ({ status: "resolved" as const }),
				(error: unknown) => ({
					status: "rejected" as const,
					message: error instanceof Error ? error.message : String(error),
				}),
			),
			new Promise<{ status: "pending" }>((resolve) =>
				setTimeout(() => resolve({ status: "pending" }), 250),
			),
		]);
		expect(overlapOutcome).toEqual({
			status: "rejected",
			message: "Compaction is already in progress for this session",
		});
		releaseCompaction();
		await firstCompaction;
	} finally {
		releaseCompaction();
		if (sessionId) removeSession(sessionId);
		runtime.unregisterProvider("faux-compact-lock");
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
	expect(result.removed).toEqual({ text: "parked one" });
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

test("an extension failing in session_start reaches the client, named, before the session registers", async () => {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) throw new Error("agent dir not isolated");
	const extensionsDir = join(agentDir, "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	const extensionPath = join(extensionsDir, "theme-probe.ts");
	writeFileSync(
		extensionPath,
		[
			'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
			"export default function (pi: ExtensionAPI) {",
			'\tpi.on("session_start", async (_event, ctx) => {',
			'\t\tctx.ui.setStatus("test", ctx.ui.theme.fg("accent", "Theme works"));',
			'\t\tthrow new Error("boom from session_start");',
			"\t});",
			"}",
			"",
		].join("\n"),
	);
	const frames: ExtUiRequest[] = [];
	setExtUiPublisher((frame) => frames.push(frame));
	try {
		const s = await createSession({ cwd: tmpCwd("trpi-extfail-"), workspaceId: "ws-extfail" });
		expect(frames.filter((frame) => frame.sessionId === s.sessionId)).toMatchObject([
			{ kind: "setStatus", key: "test", text: "Theme works" },
			{
				kind: "notify",
				level: "error",
				message: "Extension theme-probe.ts failed on session_start: boom from session_start",
			},
		]);
	} finally {
		setExtUiPublisher(() => {});
		rmSync(extensionPath, { force: true });
	}
});
