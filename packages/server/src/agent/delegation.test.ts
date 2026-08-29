import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	customMessageText,
	isSubagentCompletionMessage,
	SUBAGENT_COMPLETION_CUSTOM_TYPE,
	type DelegationRunDetails as WireRunDetails,
} from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import type { DelegationRunDetails as CoreRunDetails } from "pi-delegation";
import { SUBAGENT_COMPLETION_MESSAGE } from "pi-subagents";
import {
	abortSession,
	createSession,
	deleteSession,
	disposeAllSessions,
	getSessionMessages,
	liveParentContext,
	promptSession,
	reloadSessionResources,
	removeSession,
	removeWorkspaceSessions,
	setSessionManagerFactory,
	setSessionPublisher,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import {
	abortChildRun,
	delegationRootDir,
	delegationServiceFor,
	readChildTranscript,
} from "./delegation";
import { configurePiRuntime } from "./piRuntime";
import { setTrashImplementationForTests } from "./trash";

function fauxCore(provider: string) {
	return createFauxCore({
		provider,
		api: provider,
		models: [
			{
				id: provider,
				name: provider,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
		tokensPerSecond: 4000,
	});
}

const faux = fauxCore("faux");
const fauxbg = fauxCore("fauxbg");

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

function registerFauxProvider(runtime: ModelRuntime, core: ReturnType<typeof fauxCore>): void {
	runtime.registerProvider(core.provider, {
		api: core.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: core.streamSimple,
		models: [
			{
				id: core.provider,
				name: core.provider,
				api: core.api,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});
}

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = tmpDir("trdel-agentdir-");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	priorDataDir = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = tmpDir("trdel-data-");
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	mkdirSync(join(agentDir, "agents"), { recursive: true });
	writeFileSync(
		join(agentDir, "agents", "bg.md"),
		"---\nname: bg\ndescription: Background test agent\nmodel: fauxbg\n---\n\nRun the delegated task.\n",
	);

	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	baseRuntime = runtime;
	registerFauxProvider(runtime, faux);
	registerFauxProvider(runtime, fauxbg);
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
		info: scoutInfo(),
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

async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs = 10_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await predicate())) {
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
		info: scoutInfo(),
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
		info: scoutInfo(),
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
		info: scoutInfo(),
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
			info: scoutInfo(),
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
			info: scoutInfo(),
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

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

function widePng(width: number): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(1, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const scanline = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)]);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(scanline)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function scoutInfo() {
	return { createdBy: "tool:Agent", roleName: "scout", roleSource: "builtin" };
}

test("the host settings binding reaches workspace children: images pass to the provider raw", async () => {
	const cwd = tmpDir("trdel-img-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-img" });
	const service = delegationServiceFor("ws-img");
	const png = widePng(2001);
	writeFileSync(join(cwd, "wide.png"), png);
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: "wide.png" })),
		fauxAssistantMessage("IMG_DONE"),
	]);
	try {
		const child = await service.createChild({
			parent: sessionId,
			visibility: "hidden",
			info: scoutInfo(),
			session: { systemPrompt: "You are a test scout.", tools: ["read"] },
		});
		const outcome = await child.runQueued("Read wide.png.");
		expect(outcome.status).toBe("completed");
		const { messages } = readChildTranscript("ws-img", sessionId, child.sessionId);
		const images = messages.flatMap((message) =>
			message.role === "toolResult"
				? message.content.filter((block) => block.type === "image")
				: [],
		);
		expect(images.map((block) => block.data)).toEqual([png.toString("base64")]);
	} finally {
		await removeSession(sessionId);
	}
});

test("a queued child's transcript read answers from the registry, never NOT_FOUND", async () => {
	const cwd = tmpDir("trdel-q-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-q" });
	const service = delegationServiceFor("ws-q");
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	faux.setResponses([
		...Array.from({ length: 4 }, () => async () => {
			await gate;
			return fauxAssistantMessage("HOLDER_DONE");
		}),
		fauxAssistantMessage("FIFTH_DONE"),
	]);
	const spawn = () =>
		service.createChild({
			parent: sessionId,
			visibility: "hidden",
			info: scoutInfo(),
			session: { systemPrompt: "You are a test scout." },
		});
	try {
		const holders = await Promise.all([spawn(), spawn(), spawn(), spawn()]);
		const fifth = await spawn();
		const runs = holders.map((holder) => holder.runQueued("Hold a slot."));
		await waitFor(() => holders.every((holder) => holder.snapshot?.status === "running"));
		const fifthRun = fifth.runQueued("Wait in line.");
		expect(fifth.snapshot?.status).toBe("queued");
		const read = readChildTranscript("ws-q", sessionId, fifth.sessionId);
		expect(read.messages).toEqual([]);
		expect(read.status).toBe("queued");
		release();
		await Promise.all([...runs, fifthRun]);
	} finally {
		release();
		await removeSession(sessionId);
	}
});

test("subagent.abort aborts a live child run; a foreign parent gets not-found, child untouched", async () => {
	const cwd = tmpDir("trdel-cabort-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-cabort" });
	const service = delegationServiceFor("ws-cabort");
	const { release } = gatedChildResponse();
	try {
		const child = await service.createChild({
			parent: sessionId,
			visibility: "hidden",
			info: scoutInfo(),
			session: { systemPrompt: "You are a test scout." },
		});
		const run = child.runQueued("Long gated job.");
		await waitFor(() => child.snapshot?.status === "running");

		let foreign: unknown;
		try {
			await abortChildRun("ws-cabort", "some-other-parent", child.sessionId);
		} catch (error) {
			foreign = error;
		}
		expect(errorCodeOf(foreign)).toBe("SUBAGENT_TRANSCRIPT_NOT_FOUND");
		expect(child.snapshot?.status).toBe("running");

		const aborting = abortChildRun("ws-cabort", sessionId, child.sessionId);
		release();
		const outcome = await run;
		expect(outcome.status).toBe("aborted");
		await aborting;
	} finally {
		release();
		await removeSession(sessionId);
	}
});

async function subagentCompletions(sessionId: string, workspaceId: string, cwd: string) {
	const { messages } = await getSessionMessages(sessionId, workspaceId, cwd);
	return messages.filter((message) => isSubagentCompletionMessage(message));
}

function gatedBackgroundResponses(): { releaseChild: () => void } {
	let releaseChild!: () => void;
	const childGate = new Promise<void>((resolve) => {
		releaseChild = resolve;
	});
	fauxbg.setResponses([
		async () => {
			await childGate;
			return fauxAssistantMessage("BG_RESULT");
		},
	]);
	return { releaseChild };
}

function backgroundAgentCall() {
	return fauxAssistantMessage(
		fauxToolCall("Agent", { subagent_type: "bg", task: "Slow job.", run_in_background: true }),
	);
}

test("a background child completing inside the delete window triggers no parent turn", async () => {
	const cwd = tmpDir("trdel-delwin-");
	setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
	let trashStarted = false;
	let releaseTrash!: () => void;
	const trashGate = new Promise<void>((resolve) => {
		releaseTrash = resolve;
	});
	try {
		const { sessionId } = await createSession({ cwd, workspaceId: "ws-delwin" });
		const { releaseChild } = gatedBackgroundResponses();
		faux.setResponses([backgroundAgentCall(), fauxAssistantMessage("PARENT_IDLE")]);
		await promptSession(sessionId, "Delegate in background.");
		const service = delegationServiceFor("ws-delwin");
		const child = service.childrenOf(sessionId).at(-1);
		if (!child) throw new Error("no child spawned");
		await waitFor(() => child.snapshot?.status === "running");

		setTrashImplementationForTests(async (input) => {
			trashStarted = true;
			await trashGate;
			for (const path of typeof input === "string" ? [input] : input) {
				rmSync(path, { force: true });
			}
		});
		const deleting = deleteSession(sessionId, "ws-delwin", cwd);
		await waitFor(() => trashStarted);
		const callsBefore = faux.state.callCount + fauxbg.state.callCount;
		releaseChild();
		await waitFor(() => child.snapshot?.status === "completed");
		await Bun.sleep(50);
		expect(faux.state.callCount + fauxbg.state.callCount).toBe(callsBefore);
		releaseTrash();
		await deleting;
		expect(faux.state.callCount + fauxbg.state.callCount).toBe(callsBefore);
	} finally {
		releaseTrash();
		setTrashImplementationForTests(undefined);
		setSessionManagerFactory((sessionCwd) => SessionManager.inMemory(sessionCwd));
	}
});

test("a completion drained by Stop is re-delivered exactly once at settle", async () => {
	const cwd = tmpDir("trdel-sweep1-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-sweep1" });
	const { releaseChild } = gatedBackgroundResponses();
	let parentTurn2 = false;
	let releaseParent!: () => void;
	const parentGate = new Promise<void>((resolve) => {
		releaseParent = resolve;
	});
	faux.setResponses([
		backgroundAgentCall(),
		async () => {
			parentTurn2 = true;
			await parentGate;
			return fauxAssistantMessage("PARENT_SLOW");
		},
		fauxAssistantMessage("SWEEP_ACK"),
	]);
	try {
		const prompted = promptSession(sessionId, "Delegate and keep working.").catch(() => {});
		const service = delegationServiceFor("ws-sweep1");
		await waitFor(() => service.childrenOf(sessionId).length === 1);
		const child = service.childrenOf(sessionId)[0];
		if (!child) throw new Error("no child spawned");
		await waitFor(() => parentTurn2);
		releaseChild();
		await waitFor(() => child.snapshot?.status === "completed");
		await Bun.sleep(25);

		const stopping = abortSession(sessionId, true);
		releaseParent();
		await stopping;
		await prompted;

		await waitFor(async () => (await subagentCompletions(sessionId, "ws-sweep1", cwd)).length > 0);
		await Bun.sleep(50);
		const completions = await subagentCompletions(sessionId, "ws-sweep1", cwd);
		expect(completions).toHaveLength(1);
		expect(customMessageText(completions[0]?.content ?? "")).toContain("BG_RESULT");
		expect(faux.getPendingResponseCount()).toBe(0);
	} finally {
		releaseParent();
		await removeSession(sessionId);
	}
});

test("a reload-suppressed completion is re-delivered by the post-reload sweep", async () => {
	const cwd = tmpDir("trdel-sweep2-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-sweep2" });
	const { releaseChild } = gatedBackgroundResponses();
	faux.setResponses([backgroundAgentCall(), fauxAssistantMessage("PARENT_IDLE")]);
	try {
		await promptSession(sessionId, "Delegate in background.");
		const service = delegationServiceFor("ws-sweep2");
		const child = service.childrenOf(sessionId).at(-1);
		if (!child) throw new Error("no child spawned");
		await waitFor(() => child.snapshot?.status === "running");

		await reloadSessionResources(sessionId);
		releaseChild();
		await waitFor(() => child.snapshot?.status === "completed");
		await Bun.sleep(50);
		expect(await subagentCompletions(sessionId, "ws-sweep2", cwd)).toHaveLength(0);

		faux.setResponses([fauxAssistantMessage("SWEEP_ACK_2")]);
		await reloadSessionResources(sessionId);
		await waitFor(
			async () => (await subagentCompletions(sessionId, "ws-sweep2", cwd)).length === 1,
		);
		const completions = await subagentCompletions(sessionId, "ws-sweep2", cwd);
		expect(customMessageText(completions[0]?.content ?? "")).toContain("BG_RESULT");
	} finally {
		releaseChild();
		await removeSession(sessionId);
	}
});

test("a normally delivered background completion is not re-delivered by the sweep", async () => {
	const cwd = tmpDir("trdel-sweep3-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-sweep3" });
	const { releaseChild } = gatedBackgroundResponses();
	faux.setResponses([
		backgroundAgentCall(),
		fauxAssistantMessage("PARENT_IDLE"),
		fauxAssistantMessage("COMPLETION_ACK"),
	]);
	try {
		await promptSession(sessionId, "Delegate in background.");
		const service = delegationServiceFor("ws-sweep3");
		const child = service.childrenOf(sessionId).at(-1);
		if (!child) throw new Error("no child spawned");
		await waitFor(() => child.snapshot?.status === "running");
		releaseChild();
		await waitFor(async () => (await subagentCompletions(sessionId, "ws-sweep3", cwd)).length > 0);
		await Bun.sleep(75);
		expect(await subagentCompletions(sessionId, "ws-sweep3", cwd)).toHaveLength(1);
		expect(faux.getPendingResponseCount()).toBe(0);
	} finally {
		releaseChild();
		await removeSession(sessionId);
	}
});

test("plain Stop: pi's queued continuation delivers once and the sweep adds no second copy", async () => {
	const cwd = tmpDir("trdel-sweep4-");
	const { sessionId } = await createSession({ cwd, workspaceId: "ws-sweep4" });
	const { releaseChild } = gatedBackgroundResponses();
	let parentTurn2 = false;
	let releaseParent!: () => void;
	const parentGate = new Promise<void>((resolve) => {
		releaseParent = resolve;
	});
	faux.setResponses([
		backgroundAgentCall(),
		async () => {
			parentTurn2 = true;
			await parentGate;
			return fauxAssistantMessage("PARENT_SLOW");
		},
		fauxAssistantMessage("CONTINUATION_ACK"),
	]);
	try {
		const prompted = promptSession(sessionId, "Delegate and keep working.").catch(() => {});
		const service = delegationServiceFor("ws-sweep4");
		await waitFor(() => service.childrenOf(sessionId).length === 1);
		const child = service.childrenOf(sessionId)[0];
		if (!child) throw new Error("no child spawned");
		await waitFor(() => parentTurn2);
		releaseChild();
		await waitFor(() => child.snapshot?.status === "completed");
		await Bun.sleep(25);

		const stopping = abortSession(sessionId);
		releaseParent();
		await stopping;
		await prompted;

		await waitFor(async () => (await subagentCompletions(sessionId, "ws-sweep4", cwd)).length > 0);
		await Bun.sleep(75);
		const completions = await subagentCompletions(sessionId, "ws-sweep4", cwd);
		expect(completions).toHaveLength(1);
		expect(customMessageText(completions[0]?.content ?? "")).toContain("BG_RESULT");
		expect(faux.getPendingResponseCount()).toBe(0);
	} finally {
		releaseParent();
		await removeSession(sessionId);
	}
});
