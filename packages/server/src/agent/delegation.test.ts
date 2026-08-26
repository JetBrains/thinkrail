import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	createSession,
	disposeAllSessions,
	liveParentContext,
	removeSession,
	removeWorkspaceSessions,
	setSessionManagerFactory,
	setSessionPublisher,
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
	const retainedRuntime = parent?.modelRuntime;
	if (!retainedRuntime) throw new Error("Expected the parent runtime projection");
	configurePiRuntime(null);
	expect(liveParentContext(sessionId)?.modelRuntime).toBe(retainedRuntime);
	configurePiRuntime(retainedRuntime);
	expect(liveParentContext("not-a-session")).toBeUndefined();

	const service = await delegationServiceFor("ws-del");
	expect(await delegationServiceFor("ws-del")).toBe(service);
	expect(await delegationServiceFor("ws-other")).not.toBe(service);

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

	await removeSession(sessionId);
	expect(service.findChild(child.sessionId)).toBeUndefined();
	const afterDispose = readChildTranscript("ws-del", sessionId, child.sessionId);
	expect(afterDispose.messages.length).toBeGreaterThan(0);
	expect(afterDispose.status).toBeUndefined();

	await removeWorkspaceSessions("ws-del");
	expect(() => readChildTranscript("ws-del", sessionId, child.sessionId)).toThrow(
		"No transcript found",
	);
});

test("transcript reads reject path-like ids — wire strings never escape the delegation root", () => {
	expect(() => readChildTranscript("../../etc", "p", "c")).toThrow("Invalid workspaceId");
	expect(() => readChildTranscript("ws", "..", "c")).toThrow("Invalid parentSessionId");
	expect(() => readChildTranscript("ws", "p", "x/../y")).toThrow("Invalid childSessionId");
	expect(() => readChildTranscript("ws", "a\\b", "c")).toThrow("Invalid parentSessionId");
	expect(() => readChildTranscript("", "p", "c")).toThrow("Invalid workspaceId");
});
