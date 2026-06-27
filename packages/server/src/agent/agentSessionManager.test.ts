import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest } from "@thinkrail-pi/contracts";
import {
	createSession,
	disposeAllSessions,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	listAvailableModels,
	listSessions,
	promptSession,
	removeSession,
	setSessionManagerFactory,
	setSessionPublisher,
} from "./agentSessionManager";
import { configurePiRuntime } from "./piRuntime";
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

const events = new Map<string, unknown[]>();
const seen = (id: string) => JSON.stringify(events.get(id) ?? []);

const tmpDirs: string[] = [];
function tmpCwd(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

let priorAgentDir: string | undefined;

beforeAll(() => {
	// Isolate pi's on-disk session files to a throwaway dir — the disk-reopen test writes real ones.
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmpCwd("trpi-agentdir-");

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	// biome-ignore lint/suspicious/noExplicitAny: faux stream/model types bridge pi-ai ↔ pi-coding-agent
	const reg = modelRegistry as any;
	const cfg = (faux: typeof fauxA, id: string) => ({
		api: faux.api,
		// baseUrl + apiKey are required when models are defined; streamSimple does the real (in-process) work.
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...modelDef(id), api: faux.api }],
	});
	reg.registerProvider("fauxa", cfg(fauxA, "fauxa"));
	reg.registerProvider("fauxb", cfg(fauxB, "fauxb"));

	configurePiRuntime({ authStorage, modelRegistry });
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

test("listAvailableModels returns the configured (faux) models", () => {
	const ids = listAvailableModels().map((m) => m.id);
	expect(ids).toContain("fauxa");
	expect(ids).toContain("fauxb");
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

test("listSessions reports a workspace's live sessions; getSessionMessages returns its transcript (M16)", async () => {
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
