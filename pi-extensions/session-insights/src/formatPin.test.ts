import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tempDir } from "../test/builders.ts";
import { defaultSessionsRoot, listSessionFiles, vanillaChildTranscriptDirs } from "./discovery.ts";
import { summarizeSessionText } from "./summary.ts";

const root = tempDir("format");
let priorAgentDir: string | undefined;

beforeAll(() => {
	priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
});

afterAll(() => {
	if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	rmSync(root, { recursive: true, force: true });
});

function writeRealSession(manager: SessionManager): string {
	manager.appendMessage({ role: "user", content: "Read the README.", timestamp: Date.now() });
	manager.appendMessage(
		fauxAssistantMessage([fauxToolCall("read", { path: "README.md" }, { id: "call-1" })], {
			stopReason: "toolUse",
		}),
	);
	manager.appendMessage({
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "text", text: "no such file" }],
		isError: true,
		timestamp: Date.now(),
	});
	manager.appendSessionInfo("Readme check");
	manager.appendModelChange("faux", "faux-2");
	manager.appendMessage(fauxAssistantMessage("Done."));
	const file = manager.getSessionFile();
	if (!file) throw new Error("expected a persisted session");
	return file;
}

test("a session pi's SessionManager writes summarizes with its header identity and counts", () => {
	const cwd = join(root, "work", "..", "work");
	const manager = SessionManager.create(cwd, join(root, "explicit"));
	const file = writeRealSession(manager);
	const summary = summarizeSessionText(file, readFileSync(file, "utf8"));
	expect(summary).toMatchObject({
		sessionId: manager.getSessionId(),
		cwd: resolve(cwd),
		file,
		parentSession: null,
		title: "Readme check",
		counts: {
			userMessages: 1,
			assistantMessages: 2,
			toolCalls: 1,
			toolResults: 1,
			toolErrors: 1,
			modelChanges: 1,
			compactions: 0,
		},
		tools: { read: { calls: 1, errors: 1 } },
	});
	expect(summary?.firstPrompt).not.toBeNull();
	expect(summary?.start).toBeNumber();
});

test("discovery finds files in pi's default session layout and the vanilla delegation folder", async () => {
	const manager = SessionManager.create(join(root, "project"));
	const file = writeRealSession(manager);
	expect(defaultSessionsRoot()).toBe(join(root, "agent", "sessions"));
	expect(await listSessionFiles(defaultSessionsRoot())).toEqual([file]);
	expect(await listSessionFiles(join(root, "missing"))).toEqual([]);

	const locate = vanillaChildTranscriptDirs();
	const parent = { sessionId: manager.getSessionId(), cwd: manager.getCwd() };
	expect(await locate(parent)).toEqual([]);
	const dir = join(root, "agent", "delegation", "default", parent.sessionId);
	mkdirSync(dir, { recursive: true });
	expect(await locate(parent)).toEqual([dir]);
	expect(await locate({ sessionId: "../escape", cwd: parent.cwd })).toEqual([]);
	expect(await vanillaChildTranscriptDirs(join(root, "other"))(parent)).toEqual([]);
});
