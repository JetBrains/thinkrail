// The `start_new_chat` host compose (`startNewChatFromOrigin`) against a REAL workspace registry and a
// REAL in-process pi session on a faux provider — pinning the contracts the web fold depends on:
// the `session.created` publish carries the titled live summary and lands BEFORE the kickoff prompt's
// first pi event (per-socket FIFO is what lets a client build the runtime in time), and failures
// (unknown origin session) stay loud and publish nothing.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionCreatedPayload, Workspace } from "@thinkrail/contracts";
import {
	createSession,
	disposeAllSessions,
	setSessionManagerFactory,
	setSessionPublisher,
} from "../agent";
import { configurePiRuntime } from "../agent/piRuntime";
import { handleRequest, startNewChatFromOrigin } from "./handlers";

const CTX = { clientKey: "test-client" };

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

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

const faux = createFauxCore({
	provider: "fauxa",
	api: "fauxa",
	models: [modelDef("fauxa")],
	tokensPerSecond: 2000,
});

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let priorAgentDir: string | undefined;
let priorOffline: string | undefined;
/** Everything observed in publish order: `created:<id>` frames and `event:<id>:<type>` pi events. */
const sequence: string[] = [];

beforeAll(async () => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "trpi-compose-agent-"));
	priorOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	dataDir = mkdtempSync(join(tmpdir(), "trpi-compose-data-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	const repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);

	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("fauxa", {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "faux",
		streamSimple: faux.streamSimple,
		models: [{ ...modelDef("fauxa"), api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory(() => SessionManager.inMemory());
	setSessionPublisher(({ sessionId, event }) => {
		sequence.push(`event:${sessionId}:${(event as { type: string }).type}`);
	});
});

afterAll(() => {
	disposeAllSessions();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
});

test("the compose creates a titled sibling chat, publishes it BEFORE the kickoff's pi events, and prompts it", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const ws = rows[0];
	if (!ws) throw new Error("expected the Default workspace");

	// The origin chat the user is talking in.
	faux.setResponses([fauxAssistantMessage("KICKOFF_REPLY")]);
	const origin = await createSession({
		cwd: ws.worktreePath,
		workspaceId: ws.id,
		model: { provider: "fauxa", id: "fauxa" },
	});

	const published: SessionCreatedPayload[] = [];
	const outcome = await startNewChatFromOrigin(
		{
			originSessionId: origin.sessionId,
			prompt: "Read the handoff and implement.",
			title: "Implement X",
			model: { provider: "fauxa", id: "fauxa" },
		},
		(payload) => {
			published.push(payload);
			sequence.push(`created:${payload.summary.sessionId}`);
		},
	);

	// The broadcast carries the titled LIVE summary of a session in the origin's workspace.
	expect(published).toHaveLength(1);
	const summary = published[0]?.summary;
	expect(summary?.sessionId).toBe(outcome.sessionId);
	expect(summary?.workspaceId).toBe(ws.id);
	expect(summary?.title).toBe("Implement X");
	expect(summary?.live).toBe(true);
	expect(outcome.title).toBe("Implement X");
	expect(outcome.sessionId).not.toBe(origin.sessionId);

	// Ordering: the created frame precedes every pi event of the NEW session (the web fold's contract).
	const createdAt = sequence.indexOf(`created:${outcome.sessionId}`);
	const firstEvent = sequence.findIndex((s) => s.startsWith(`event:${outcome.sessionId}:`));
	expect(createdAt).toBeGreaterThanOrEqual(0);
	expect(firstEvent).toBeGreaterThan(createdAt);

	// The kickoff prompt actually ran in the new chat (accept-ack resolved; faux streamed its reply).
	const kicked = sequence.filter((s) => s.startsWith(`event:${outcome.sessionId}:`));
	expect(kicked.length).toBeGreaterThan(0);
});

test("an unknown origin session fails loud and publishes nothing", async () => {
	const published: SessionCreatedPayload[] = [];
	await expect(
		startNewChatFromOrigin({ originSessionId: "no-such-session", prompt: "Go." }, (payload) =>
			published.push(payload),
		),
	).rejects.toThrow(/not attached to a workspace/);
	expect(published).toHaveLength(0);
});
