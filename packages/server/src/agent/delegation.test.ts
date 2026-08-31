import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	SUBAGENT_COMPLETION_CUSTOM_TYPE,
	type DelegationRunDetails as WireRunDetails,
} from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import type { DelegationRunDetails as CoreRunDetails } from "pi-delegation";
import { SUBAGENT_COMPLETION_MESSAGE } from "pi-subagents";
import {
	createSession,
	deleteSession,
	disposeAllSessions,
	liveParentContext,
	removeSession,
	removeWorkspaceSessions,
	setSessionManagerFactory,
	setSessionPublisher,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import { delegationRootDir, delegationServiceFor, readChildTranscript } from "./delegation";
import { configurePiRuntime } from "./piRuntime";

const faux = createFauxCore({
	provider: "faux",
	api: "faux",
	models: [
		{
			id: "faux",
			name: "faux",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
	tokensPerSecond: 4000,
});

const tmpDirs: string[] = [];
function tmpDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

let priorAgentDir: string | undefined;
let priorDataDir: string | undefined;
let priorOffline: string | undefined;
let baseRuntime: ModelRuntime;

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmpDir("trdel-agentdir-");
	priorDataDir = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = tmpDir("trdel-data-");
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	baseRuntime = runtime;
	runtime.registerProvider("faux", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [
			{
				id: "faux",
				name: "faux",
				api: faux.api,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
	setSessionPublisher(() => {});
});

afterAll(() => {
	disposeAllSessions();
	configurePiRuntime(null);
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = priorDataDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

test("host embedding: projection, per-workspace service, transcript store, cascades, retention", async () => {
	const cwd = tmpDir("trdel-ws-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-del" });

	const parent = liveParentContext(sessionId);
	expect(parent?.cwd).toBe(cwd);
	expect(parent?.model?.provider).toBe("faux");
	expect(parent?.modelRuntime).toBe(baseRuntime);
	expect(liveParentContext("not-a-session")).toBeUndefined();

	const service = delegationServiceFor("ws-del");
	expect(delegationServiceFor("ws-del")).toBe(service);
	expect(delegationServiceFor("ws-other")).not.toBe(service);

	faux.setResponses([fauxAssistantMessage("CHILD_DONE")]);
	const child = await service.createChild({
		parent: sessionId,
		visibility: "hidden",
		info: { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" },
		session: { systemPrompt: "You are a test scout." },
	});
	const outcome = await child.runQueued("Report.");
	expect(outcome.status).toBe("completed");
	expect(child.record.sessionFile.startsWith(join(delegationRootDir(), "ws-del"))).toBe(true);

	const read = readChildTranscript("ws-del", sessionId, child.sessionId);
	expect(JSON.stringify(read.messages)).toContain("CHILD_DONE");
	expect(read.status).toBe("completed");

	const childManager = SessionManager.open(child.record.sessionFile);
	const lastEntryId = childManager.getEntries().at(-1)?.id;
	if (!lastEntryId) throw new Error("expected child entries");
	childManager.appendCompaction("COMPACTED_CONTEXT", lastEntryId, 12_345);
	const compacted = readChildTranscript("ws-del", sessionId, child.sessionId);
	expect(
		compacted.messages.some(
			(message) => message.role === "compactionSummary" && message.summary === "COMPACTED_CONTEXT",
		),
	).toBe(true);

	await removeSession(sessionId);
	expect(service.findChild(child.sessionId)).toBeUndefined();
	const afterDispose = readChildTranscript("ws-del", sessionId, child.sessionId);
	expect(afterDispose.messages.length).toBeGreaterThan(0);
	expect(afterDispose.status).toBeUndefined();

	await removeWorkspaceSessions("ws-del");
	let missing: unknown;
	try {
		readChildTranscript("ws-del", sessionId, child.sessionId);
	} catch (err) {
		missing = err;
	}
	expect(String(missing)).toContain("No transcript found");
	expect(errorCodeOf(missing)).toBe("SUBAGENT_TRANSCRIPT_NOT_FOUND");
});

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for condition");
		await Bun.sleep(10);
	}
}

function gatedChildResponse(): { release: () => void } {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	faux.setResponses([
		async () => {
			await gate;
			return fauxAssistantMessage("GATED_DONE");
		},
	]);
	return { release };
}

test("deleteSession resolves only after its child cascade settles", async () => {
	const cwd = tmpDir("trdel-await-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-await" });
	const service = delegationServiceFor("ws-await");
	const { release } = gatedChildResponse();
	const child = await service.createChild({
		parent: sessionId,
		visibility: "hidden",
		info: { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" },
		session: { systemPrompt: "You are a test scout." },
	});
	const run = child.runQueued("Long gated job.");
	await waitFor(() => child.snapshot?.status === "running");

	let deleted = false;
	const done = deleteSession(sessionId, "ws-await", cwd).then(() => {
		deleted = true;
	});
	await waitFor(() => liveParentContext(sessionId) === undefined);
	expect(deleted).toBe(false);

	release();
	await done;
	expect(deleted).toBe(true);
	await run;
});

test("workspace archival awaits in-flight delete transactions before deleting the store", async () => {
	const cwd = tmpDir("trdel-arch-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-arch" });
	const service = delegationServiceFor("ws-arch");
	const { release } = gatedChildResponse();
	const child = await service.createChild({
		parent: sessionId,
		visibility: "hidden",
		info: { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" },
		session: { systemPrompt: "You are a test scout." },
	});
	const run = child.runQueued("Long gated job.");
	await waitFor(() => child.snapshot?.status === "running");

	let storeAliveAtCascadeEnd: boolean | undefined;
	const unsubscribe = service.onLifecycle((event) => {
		if (event.type === "child-disposed" && event.sessionId === child.sessionId) {
			storeAliveAtCascadeEnd = existsSync(child.record.sessionFile);
		}
	});
	const done = deleteSession(sessionId, "ws-arch", cwd);
	await waitFor(() => liveParentContext(sessionId) === undefined);
	const archived = removeWorkspaceSessions("ws-arch", cwd);
	release();
	await Promise.all([done, archived, run]);
	unsubscribe();
	expect(storeAliveAtCascadeEnd).toBe(true);
});

test("graceful shutdown waits for a background child cascade", async () => {
	const cwd = tmpDir("trdel-shutdown-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-shutdown" });
	const service = delegationServiceFor("ws-shutdown");
	const { release } = gatedChildResponse();
	const child = await service.createChild({
		parent: sessionId,
		visibility: "hidden",
		info: { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" },
		session: { systemPrompt: "You are a test scout." },
	});
	const run = child.runQueued("Long background job.");
	await waitFor(() => child.snapshot?.status === "running");

	const settled = settleSessionsForShutdown(10_000).then(() => "settled" as const);
	expect(await Promise.race([settled, Promise.resolve("pending" as const)])).toBe("pending");
	release();
	await Promise.all([settled, run]);
	expect(service.findChild(child.sessionId)).toBeUndefined();
	await removeSession(sessionId);
});

test("children follow their parent's retained runtime generation across a flip", async () => {
	const cwdOld = tmpDir("trdel-flip-old-");
	const { sessionId: oldParent } = await createSession({ cwd: cwdOld, workspaceId: "ws-flip" });
	const service = delegationServiceFor("ws-flip");
	const gen2 = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	gen2.registerProvider("fauxg2", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [
			{
				id: "fauxg2",
				name: "fauxg2",
				api: faux.api,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});
	let newParent: string | undefined;
	try {
		configurePiRuntime(gen2);
		expect(liveParentContext(oldParent)?.modelRuntime).toBe(baseRuntime);
		faux.setResponses([fauxAssistantMessage("OLD_GEN_DONE")]);
		const oldChild = await service.createChild({
			parent: oldParent,
			visibility: "hidden",
			info: { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" },
			session: { systemPrompt: "old-parent probe" },
		});
		const oldOutcome = await oldChild.runQueued("Probe old.");
		expect(oldOutcome.status).toBe("completed");
		expect(oldOutcome.details.model).toBe("faux/faux");
		await oldChild.dispose();

		const cwdNew = tmpDir("trdel-flip-new-");
		({ sessionId: newParent } = await createSession({ cwd: cwdNew, workspaceId: "ws-flip" }));
		expect(liveParentContext(newParent)?.modelRuntime).toBe(gen2);
		faux.setResponses([fauxAssistantMessage("NEW_GEN_DONE")]);
		const newChild = await service.createChild({
			parent: newParent,
			visibility: "hidden",
			info: { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" },
			session: { systemPrompt: "new-parent probe", model: { provider: "fauxg2", id: "fauxg2" } },
		});
		const newOutcome = await newChild.runQueued("Probe new.");
		expect(newOutcome.status).toBe("completed");
		expect(newOutcome.details.model).toBe("fauxg2/fauxg2");
	} finally {
		configurePiRuntime(baseRuntime);
		await removeSession(oldParent);
		if (newParent) await removeSession(newParent);
	}
});

test("transcript reads reject path-like ids — wire strings never escape the delegation root", () => {
	expect(() => readChildTranscript("../../etc", "p", "c")).toThrow("Invalid workspaceId");
	expect(() => readChildTranscript("ws", "..", "c")).toThrow("Invalid parentSessionId");
	expect(() => readChildTranscript("ws", "p", "x/../y")).toThrow("Invalid childSessionId");
	expect(() => readChildTranscript("ws", "a\\b", "c")).toThrow("Invalid parentSessionId");
	expect(() => readChildTranscript("", "p", "c")).toThrow("Invalid workspaceId");
});

test("the wire mirrors never drift: completion tag and DelegationRunDetails shape", () => {
	expect(SUBAGENT_COMPLETION_CUSTOM_TYPE).toBe(SUBAGENT_COMPLETION_MESSAGE);
	function pinMirror(core: CoreRunDetails, wire: WireRunDetails): [WireRunDetails, CoreRunDetails] {
		return [core, wire];
	}
	expect(typeof pinMirror).toBe("function");
});
