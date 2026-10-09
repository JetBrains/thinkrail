import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	createSession,
	disposeAllSessions,
	removeSession,
	setSessionManagerFactory,
	settleSessionsForShutdown,
} from "./agentSessionManager";
import { configurePiRuntime } from "./piRuntime";

const model = {
	id: "shutdown",
	name: "shutdown",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4096,
};
const faux = createFauxCore({ provider: "shutdown", api: "shutdown", models: [model] });
const saved = {
	agent: process.env.PI_CODING_AGENT_DIR,
	data: process.env.THINKRAIL_DATA_DIR,
	offline: process.env.PI_OFFLINE,
};
const root = mkdtempSync(join(tmpdir(), "session-shutdown-"));
const agentDir = join(root, "agent");
const marker = join(root, "shutdown-events.jsonl");
let sequence = 0;

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_OFFLINE = "1";
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	// The handler's delay is what lets the test tell "awaited" from "fired and forgotten".
	writeFileSync(
		join(agentDir, "extensions", "shutdown-probe.ts"),
		[
			'import { appendFileSync, existsSync } from "node:fs";',
			`const marker = ${JSON.stringify(marker)};`,
			`const hang = ${JSON.stringify(join(root, "HANG"))};`,
			"export default function probe(pi) {",
			'  pi.on("session_shutdown", async (event) => {',
			"    if (existsSync(hang)) await new Promise(() => {});",
			"    await new Promise((resolve) => setTimeout(resolve, 50));",
			'    appendFileSync(marker, JSON.stringify({ reason: event.reason }) + "\\n");',
			"  });",
			"}",
			"",
		].join("\n"),
	);
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("shutdown", {
		api: faux.api,
		apiKey: "test",
		baseUrl: "http://faux.local",
		streamSimple: faux.streamSimple,
		models: [{ ...model, api: faux.api }],
	});
	configurePiRuntime(runtime);
	setSessionManagerFactory((cwd) => SessionManager.inMemory(cwd));
});

afterAll(async () => {
	await settleSessionsForShutdown();
	disposeAllSessions();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.offline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = saved.offline;
	rmSync(root, { recursive: true, force: true });
});

function shutdownEvents(): { reason: string }[] {
	try {
		return readFileSync(marker, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { reason: string });
	} catch {
		return [];
	}
}

async function parent() {
	const workspaceId = `shutdown-${++sequence}`;
	const cwd = mkdtempSync(join(root, "cwd-"));
	const { sessionId } = await createSession({ workspaceId, cwd });
	return { workspaceId, cwd, sessionId };
}

test("removing a session emits session_shutdown to extensions and awaits their handlers", async () => {
	const before = shutdownEvents().length;
	const p = await parent();
	await removeSession(p.sessionId);
	expect(shutdownEvents().slice(before)).toEqual([{ reason: "quit" }]);
});

test("a shutdown handler that never settles is bounded by the shutdown budget", async () => {
	const before = shutdownEvents().length;
	const p = await parent();
	writeFileSync(join(root, "HANG"), "");
	try {
		const started = Date.now();
		await settleSessionsForShutdown(300);
		await removeSession(p.sessionId);
		expect(Date.now() - started).toBeLessThan(2500);
		expect(shutdownEvents().length).toBe(before);
	} finally {
		rmSync(join(root, "HANG"), { force: true });
	}
});
