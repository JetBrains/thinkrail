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
	removeSession,
	removeWorkspaceSessions,
	setSessionDeletedPublisher,
	setSessionManagerFactory,
	setSessionPublisher,
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

/** A complete model definition for `registerProvider` (faux defaults are looser). */
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

// One faux provider per session so each streams its own deterministic text, regardless of interleaving.
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
// Registered only DURING the catalog-refresh test below — the "newly shipped" model a refresh delivers.
const fauxC = createFauxCore({
	provider: "fauxc",
	api: "fauxc",
	models: [modelDef("fauxc")],
	tokensPerSecond: 2000,
});

/** Provider config for `registerProvider` (baseUrl + apiKey are required when models are defined). */
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
	// Isolate pi's on-disk session files to a throwaway dir — the disk-reopen test writes real ones.
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmpCwd("trpi-agentdir-");

	// `listAvailableModels` fires a detached network catalog refresh (issue #98) — keep this suite
	// hermetic the same way e2e is, via pi's own PI_OFFLINE convention. The refresh tests lift it locally.
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	// A REAL runtime (in-memory credentials, no models.json, no network) with the faux providers
	// registered as extension providers — their `streamSimple` does the real (in-process) work.
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

	// Each session's events carry only its own model's reply — they don't cross over.
	expect(seen(a.sessionId)).toContain("ALPHA_REPLY");
	expect(seen(a.sessionId)).not.toContain("BRAVO_REPLY");
	expect(seen(b.sessionId)).toContain("BRAVO_REPLY");
	expect(seen(b.sessionId)).not.toContain("ALPHA_REPLY");

	// Dispose A; B keeps streaming a fresh turn while A receives nothing more.
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
	// Off so the read tool bypasses pi's photon resizer (not bundled in the single-file binary).
	expect(buildSessionSettings(tmpCwd("trpi-settings-")).getImageAutoResize()).toBe(false);
});

test("listAvailableModels returns the configured (faux) models", async () => {
	const ids = (await listAvailableModels()).map((m) => m.id);
	expect(ids).toContain("fauxa");
	expect(ids).toContain("fauxb");
});

/** Let a detached refresh task's `.then/.finally` chain settle (macrotask — nothing sleeps). */
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
		// Resolves immediately from the snapshot while the "network" refresh hangs unresolved.
		const ids = (await listAvailableModels()).map((m) => m.id);
		expect(ids).toContain("fauxa");
	} finally {
		releaseHang(); // frees the single-flight slot so this test leaves no pending state behind
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
		// The first "network" refresh delivers a new provider+model when it lands — deferred, so the first
		// read provably serves the pre-refresh snapshot. Any later trigger settles instantly and delivers
		// nothing, mirroring pi's freshness throttle.
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

		const before = (await listAvailableModels()).map((m) => m.id); // triggers the detached refresh
		expect(before).not.toContain("fauxc");

		landRefresh();
		await refreshSettled();

		const after = (await listAvailableModels()).map((m) => m.id);
		expect(after).toContain("fauxc");
	} finally {
		await refreshSettled(); // let the second trigger's instant refresh settle before restoring
		runtime.unregisterProvider("fauxc");
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

test("wire models expose only the allowlisted fields (no baseUrl/headers/other Model fields)", async () => {
	// The faux providers register with baseUrl "http://faux.local"; when JetBrains AI is wired the real
	// baseUrl is `.../wire/<SECRET>/...`. `toWireModel` is an allowlist projection, so a wire model carries
	// EXACTLY these keys — this pins the DTO shut (widening it, incl. re-adding a secret field, fails here).
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
		// Faux models declare `reasoning: false` — pi's support truth for those is exactly ["off"].
		expect(m.thinkingLevels).toEqual(["off"]);
	}
});

test("thinkingLevels is pi's per-model support truth, not a reasoning boolean widened to all seven", () => {
	// Every registered faux model is non-reasoning, so `["off"]` alone can be satisfied by a constant.
	// `toWireModel` is a pure projection, so pin the interesting half directly: a reasoning model exposes
	// the escalation ladder, and `xhigh`/`max` appear ONLY when `thinkingLevelMap` maps them.
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

	// A level the model explicitly cannot do is dropped, even on a reasoning model.
	const alwaysThinks: Model<string> = { ...reasoner, thinkingLevelMap: { off: null } };
	expect(toWireModel(alwaysThinks).thinkingLevels).not.toContain("off");
});

test("model.clampThinking answers with pi's clamp, not a plausible client-side policy", async () => {
	// Review finding on the pre-session picker: any rule invented client-side diverges from pi. These are
	// the two shapes that separate pi's upward-then-downward clamp from the likely local heuristics — a
	// midpoint would say `medium` then `high`; "nearest below" would say `xhigh` then nothing.
	// A reasoning provider has to be registered for this: `clampThinkingForModel` re-resolves the ref,
	// and every other faux model is non-reasoning (supported set exactly `["off"]`, which every policy
	// agrees on and so proves nothing).
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
		// `[off, minimal, low, medium, high, xhigh]` — `max` is unmapped, so upward is exhausted.
		expect(await clampThinkingForModel({ provider: "clamp5", id: "clamp5" }, "max")).toBe("xhigh");
		// `[low, high]` — nothing below `off`, so pi goes upward instead.
		expect(await clampThinkingForModel({ provider: "clamp2", id: "clamp2" }, "off")).toBe("low");
		// A level the model does support is returned untouched.
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
	// A `high` saved from a reasoning model plus a non-reasoning default model must not surface as a
	// disabled-but-selected level — the host returns a self-consistent pair, clamped with pi's own
	// `clampThinkingLevel` (faux models don't reason → exactly ["off"]).
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
	// Under the suite's PI_OFFLINE the awaited refresh is an immediate no-op — the point here is the
	// path: refreshAvailableModels must answer with the same allowlist projection as listAvailableModels.
	const [listed, refreshed] = [await listAvailableModels(), await refreshAvailableModels()];
	expect(refreshed.models).toEqual(listed);
	expect(refreshed.models.length).toBeGreaterThan(0);
	// Nothing to fetch under PI_OFFLINE, so the registry as it stands IS the settled answer.
	expect(refreshed.complete).toBe(true);
});

test("model.refresh WAITS for the refresh — its list already includes what the refresh landed", async () => {
	// The one thing `model.refresh` does that `model.list` doesn't. It has to be pinned off PI_OFFLINE
	// (which short-circuits the refresh to a resolved promise) and against a refresh that lands LATER
	// than the call: a detached trigger would answer from the pre-refresh snapshot and miss `fauxc`.
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
		expect(refreshed.complete).toBe(true); // the pass settled well inside the budget
	} finally {
		runtime.unregisterProvider("fauxc");
		runtime.refresh = originalRefresh;
		process.env.PI_OFFLINE = "1";
	}
});

/**
 * Yield microtasks until the awaited wire call has armed its own deadline timer (it resolves the memoized
 * runtime first, so the timer does not exist in the tick the call is made). Asserted rather than assumed:
 * advancing an unarmed fake clock would leave the test waiting on a promise nothing can resolve.
 */
async function armedDeadline(before: number): Promise<void> {
	for (let i = 0; i < 100 && jest.getTimerCount() <= before; i++) await Promise.resolve();
	expect(jest.getTimerCount()).toBeGreaterThan(before);
}

// The finding this pins, at the WIRE call rather than at `refreshCatalogs`: pi's `getAvailable()` awaits
// `refreshAvailability()` — the unsignalled per-provider auth fan-out, which it *starts* when none is
// pending — so reading through it would hand every model call an unbounded wait and would escape the
// refresh deadline one line after it was applied. Both wire calls read pi's settled snapshot instead, and a
// pass that never settled is never reported as authoritative.
test("a stalled availability fan-out neither blocks a model call nor authorizes its list", async () => {
	delete process.env.PI_OFFLINE;
	const originalRefresh = runtime.refresh.bind(runtime);
	const originalGetAvailable = runtime.getAvailable.bind(runtime);
	jest.useFakeTimers();
	try {
		runtime.getAvailable = () => new Promise<never>(() => {}); // the stalled provider check
		runtime.refresh = () => new Promise<never>(() => {}); // ...and the catalog pass it hangs
		const listed = await listAvailableModels();
		expect(listed.map((m) => m.id)).toContain("fauxa"); // served, not blocked
		const pendingTimers = jest.getTimerCount();

		const refreshing = refreshAvailableModels(true);
		await armedDeadline(pendingTimers); // it awaits the runtime first — don't advance an unarmed timer
		jest.advanceTimersByTime(15_000); // the caller's ceiling
		const refreshed = await refreshing;
		expect(refreshed.models).toEqual(listed); // the registry as it stands
		expect(refreshed.complete).toBe(false); // ...and the client must not call it settled
	} finally {
		jest.useRealTimers();
		runtime.getAvailable = originalGetAvailable;
		runtime.refresh = originalRefresh;
		// Restored BEFORE anything else touches the runtime: the never-settling pass still owns the
		// single-flight slot, and PI_OFFLINE short-circuits every later trigger before it can join.
		process.env.PI_OFFLINE = "1";
	}
});

test("createSession re-resolves a wire model ref by {provider,id}, never trusting a client baseUrl", async () => {
	fauxA.setResponses([fauxAssistantMessage("RESOLVED_REPLY")]);
	const ref = (await listAvailableModels()).find((m) => m.id === "fauxa");
	if (!ref) throw new Error("faux model missing");
	// `ref` has NO baseUrl — only host-side re-resolution against the registry can reach the faux provider.
	const s = await createSession({
		cwd: tmpCwd("trpi-resolve-"),
		workspaceId: "ws-res",
		model: ref,
	});
	await promptSession(s.sessionId, "hi");
	expect(seen(s.sessionId)).toContain("RESOLVED_REPLY");
	// The create result echoes the model back as a wire model — still no secret.
	expect(s.model).not.toBeNull();
	expect(s.model).not.toHaveProperty("baseUrl");
	removeSession(s.sessionId);
});

test("createSession rejects an unknown/unavailable model ref (no arbitrary baseUrl injection)", async () => {
	const ref = (await listAvailableModels()).find((m) => m.id === "fauxa");
	if (!ref) throw new Error("faux model missing");
	// A client points provider/id at something not in the registry — the host refuses rather than call it.
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

	// No extensions/skills in an in-memory faux session, but the catalog read must still succeed.
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
	expect(await listSessions("ws-other", cwd)).toHaveLength(0); // scoped to the workspace

	// The transcript is the pi-canonical user/assistant messages — what a hydrating client folds into turns.
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
		// Model pi's synchronous truncate→rewrite window at its worst point: the registered runtime is still
		// authoritative, while its exact physical path temporarily has no readable header.
		writeFileSync(sessionFile, "");
		expect((await listSessions("ws-live-rewrite", cwd)).map((row) => row.sessionId)).toContain(
			s.sessionId,
		);

		removeSession(s.sessionId);
		// Once detached, the same malformed file is no longer exempt: absence must never be inferred from it.
		await expect(listSessions("ws-live-rewrite", cwd)).rejects.toThrow("unreadable or malformed");
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("disk-reopen: a disposed session is re-listed from disk and re-opened with its transcript (restart survival)", async () => {
	// Disk-backed for this test (the others use in-memory): persist a real session file, then drop it from RAM.
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
		removeSession(s.sessionId); // gone from memory; the on-disk transcript remains

		// It comes back from disk as a non-live summary…
		const fromDisk = (await listSessions("ws-disk", cwd)).find((x) => x.sessionId === s.sessionId);
		expect(fromDisk).toBeDefined();
		expect(fromDisk?.live).toBe(false);

		// …but is scoped to its own worktree — another workspace's (cwd's) list must not leak it.
		const otherCwd = tmpCwd("trpi-other-");
		expect((await listSessions("ws-other", otherCwd)).map((x) => x.sessionId)).not.toContain(
			s.sessionId,
		);

		// …and getSessionMessages re-opens it (now live) with its transcript intact.
		const { summary, messages } = await getSessionMessages(s.sessionId, "ws-disk", cwd);
		expect(summary.live).toBe(true);
		expect(messages.some((m) => m.role === "user")).toBe(true);
		removeSession(s.sessionId);

		// Concurrent re-opens (two tabs / a double-click) attach exactly once — both resolve and the session
		// is live a single time, not duplicated into two AgentSessions on the same id.
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
		// A live session's own manager still knows this exact file even when directory listing would skip its
		// temporarily malformed header. Deletion must move that file, not treat the skipped entry as absent.
		writeFileSync(info.path, "temporarily malformed\n");

		await deleteSession(session.sessionId, "ws-delete", cwd);
		expect(hasSession(session.sessionId)).toBe(false);
		expect(existsSync(info.path)).toBe(false);

		// Model a disk-open that began before deletion: its stale path/data must not register after the delete.
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
		removeSession(session.sessionId); // host restart: only the disk lookup can identify it now
		writeFileSync(info.path, "not a pi transcript\n");

		// Both the reconnect membership read and explicit deletion fail closed. Neither may turn pi's
		// presentation-friendly skipped entry into a durable "this chat is absent" decision.
		await expect(listSessions("ws-delete-corrupt", cwd)).rejects.toThrow("unreadable or malformed");
		await expect(deleteSession(session.sessionId, "ws-delete-corrupt", cwd)).rejects.toThrow(
			"unreadable or malformed",
		);
		expect(trashCalls).toBe(0);
		expect(published).toEqual([]);
		expect(existsSync(info.path)).toBe(true);

		// Restoring the bytes makes the same id attachable again: failed deletion rolled its tombstone back.
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
		// The entry remains registered for rollback, but the tombstone makes it unaddressable for the
		// full transaction. A second client cannot append a turn or dispose the rollback target.
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

		// Rollback removes the gate as well as retaining the entry: the same runtime accepts later work.
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
	// Regression (Air): two clients trashing the same chat must not run rival transactions. A loser's
	// rollback could otherwise clear the winner's tombstone mid-move, re-opening the chat to a new turn
	// that the winner's move then loses or that recreates the deleted file.
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

		// Two clients trash the same chat at once — the second joins the first: one trash, one owner.
		first = deleteSession(session.sessionId, "ws-delete-coalesce", cwd);
		second = deleteSession(session.sessionId, "ws-delete-coalesce", cwd);
		await trashStarted;
		expect(trashCalls).toBe(1);

		// The tombstone holds throughout the single pending move: no live command slips through.
		await expect(promptSession(session.sessionId, "must not be accepted")).rejects.toThrow(
			`Unknown session: ${session.sessionId}`,
		);

		// The sole owner's trash fails → both callers reject, and the tombstone it installed is rolled back,
		// so the same runtime is addressable again — never left un-openable by a loser's stale clear.
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
	// Regression: the delete tombstone makes the retained entry reject `removeSession`, so archival must
	// dispose unconditionally. Otherwise one in-flight chat delete would abort the loop and strand the
	// workspace's other sessions + the disk purge.
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
		await trashStarted; // tombstone set, entry retained, trash blocked mid-flight

		// The whole-workspace teardown must run to completion despite the pending per-chat delete guard.
		await removeWorkspaceSessions("ws-archive-during-delete", cwd);
		expect(hasSession(doomed.sessionId)).toBe(false);
		expect(existsSync(info.path)).toBe(false); // the disk purge ran; the loop was not aborted
	} finally {
		failTrash();
		await deleting?.catch(() => {});
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("ensureSessionAttached: a detached-but-persisted session comes back live; a missing id is `false`", async () => {
	// What the review's batch send stands on: `Review.sessionId` outlives the host, so "not live" must
	// mean "re-open it", not "there is no chat" — the latter forks the review into a second chat.
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
		removeSession(s.sessionId); // host restart: transcript on disk, nothing in memory
		expect(hasSession(s.sessionId)).toBe(false);

		expect(await ensureSessionAttached(s.sessionId, "ws-reattach", cwd)).toBe(true);
		expect(hasSession(s.sessionId)).toBe(true);
		// Already live → a no-op that still answers yes (the routine second batch).
		expect(await ensureSessionAttached(s.sessionId, "ws-reattach", cwd)).toBe(true);

		// A genuinely absent transcript is the ONE recoverable case, reported as `false` rather than thrown.
		expect(await ensureSessionAttached("no-such-session", "ws-reattach", cwd)).toBe(false);
		removeSession(s.sessionId);
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("followUpSession on an IDLE session runs the turn — pi's follow-up queue has nothing to drain it", async () => {
	// The other half of the review's batch send: it follows up into the file's review chat, which is idle
	// by construction (the previous turn ended; after a restart it was only just re-attached). pi's
	// `followUp()` merely ENQUEUES, and that queue is drained by a run already in flight — parking there
	// would mark the comments sent to an agent that never saw them.
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

test("removeWorkspaceSessions: archives a workspace's live sessions + purges their on-disk transcripts, leaving siblings", async () => {
	// Disk-backed so there are real transcript files to purge (the other faux tests run in-memory).
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

		// Both persisted a transcript on disk before the archive.
		expect(await listSessions("ws-doomed", doomedCwd)).toHaveLength(1);
		expect(await listSessions("ws-keep", keepCwd)).toHaveLength(1);

		await removeWorkspaceSessions("ws-doomed", doomedCwd);

		// The archived workspace has no session left — not live, and not on disk.
		expect(hasSession(doomed.sessionId)).toBe(false);
		expect(await listSessions("ws-doomed", doomedCwd)).toHaveLength(0);
		// A sibling workspace is untouched: still live and still on disk.
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

	// confirm → the browser's `true` reply resolves the awaiting promise.
	const confirmP = ui.confirm("Proceed?", "Apply the change?");
	const confirmFrame = lastFrame();
	expect(confirmFrame.kind).toBe("confirm");
	expect(confirmFrame.sessionId).toBe("sess-extui");
	resolveExtUi({ id: confirmFrame.id, value: true });
	expect(await confirmP).toBe(true);

	// select → a null reply (cancelled) maps back to undefined.
	const selectP = ui.select("Pick one", ["a", "b"]);
	resolveExtUi({ id: lastFrame().id, value: null });
	expect(await selectP).toBeUndefined();

	// A dialog still awaiting when its session is disposed is settled (undefined) and dismissed in the UI.
	const inputP = ui.input("Name?");
	const inputFrame = lastFrame();
	cancelExtUiForSession("sess-extui");
	expect(await inputP).toBeUndefined();
	expect(frames.some((f) => f.kind === "dismiss" && f.id === inputFrame.id)).toBe(true);

	setExtUiPublisher(() => {});
});
