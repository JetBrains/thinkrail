import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ToolResponsePendingDetails, Usage } from "@thinkrail/contracts";
import { deriveChildSessionFile } from "pi-delegation";
import { defaultSessionDirFor, delegationSessionDirFor, writeFixtureSession } from "./testFixtures";

function fixtureUsage(input: number, output: number, cost: number): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

describe("writeFixtureSession — pinned against pi's real SessionManager", () => {
	test("explicit sessionDir layout: SessionManager.list(cwd, dir) round-trips id/cwd/name/messageCount", async () => {
		const dir = mkdtempSync(join(tmpdir(), "trpi-fixture-explicit-"));
		try {
			const cwd = "/tmp/thinkrail-a5-pin-explicit";
			writeFixtureSession(dir, {
				id: "pin-explicit-1",
				cwd,
				name: "Pin test session",
				messages: [
					{ role: "user", text: "hello", timestamp: 1_700_000_000_000 },
					{ role: "assistant", text: "hi there", timestamp: 1_700_000_001_000 },
				],
			});

			const sessions = await SessionManager.list(cwd, dir);

			expect(sessions).toHaveLength(1);
			expect(sessions[0]).toMatchObject({
				id: "pin-explicit-1",
				cwd,
				name: "Pin test session",
				messageCount: 2,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("canonical ask_user_question toolCall + ack details round-trip through SessionManager", () => {
		const dir = mkdtempSync(join(tmpdir(), "trpi-fixture-toolcall-"));
		try {
			const toolCallId = "ask-fixture-1";
			const args = {
				questions: [
					{
						question: "Which rollout?",
						header: "Rollout",
						options: [
							{ label: "Canary", description: "Start with a small cohort." },
							{ label: "Everyone", description: "Release in one step." },
						],
					},
				],
			};
			const ack: ToolResponsePendingDetails = { kind: "ack" };
			const { path } = writeFixtureSession(dir, {
				id: "pin-toolcall-1",
				cwd: "/tmp/thinkrail-toolcall-pin",
				messages: [
					{ role: "user", text: "Help choose a rollout.", timestamp: 1_700_000_000_000 },
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: toolCallId,
								name: "ask_user_question",
								arguments: args,
							},
						],
						stopReason: "toolUse",
						timestamp: 1_700_000_001_000,
					},
					{
						role: "toolResult",
						toolCallId,
						toolName: "ask_user_question",
						content: [{ type: "text", text: "Questions shown to the user." }],
						details: ack,
						isError: false,
						timestamp: 1_700_000_002_000,
					},
				],
			});

			const messages = SessionManager.open(path).buildSessionContext().messages;
			expect(messages).toHaveLength(3);
			expect(messages[1]).toMatchObject({
				role: "assistant",
				stopReason: "toolUse",
				content: [{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: args }],
			});
			expect(messages[2]).toMatchObject({
				role: "toolResult",
				toolCallId,
				toolName: "ask_user_question",
				details: { kind: "ack" },
				isError: false,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("system messages, a model change and a compaction round-trip through SessionManager's context", () => {
		const dir = mkdtempSync(join(tmpdir(), "trpi-fixture-system-"));
		try {
			const tool = { name: "read", description: "Read a file.", parameters: { type: "object" } };
			const { path } = writeFixtureSession(dir, {
				id: "pin-system-1",
				cwd: "/tmp/thinkrail-system-pin",
				messages: [
					{
						role: "system",
						sections: { preamble: "You are a coding agent." },
						toolsAdded: [tool],
						timestamp: 1_700_000_000_000,
					},
					{ role: "user", text: "First.", timestamp: 1_700_000_000_500 },
					{ role: "assistant", text: "One.", timestamp: 1_700_000_001_000 },
					{
						role: "modelChange",
						provider: "openai",
						modelId: "gpt-test",
						timestamp: 1_700_000_001_500,
					},
					{ role: "user", text: "Second.", timestamp: 1_700_000_002_000 },
					{
						role: "compaction",
						summary: "We said one.",
						tokensBefore: 1_000,
						firstKept: 4,
						systemMessage: {
							role: "system",
							content: "",
							sections: { preamble: "You are a coding agent." },
							toolsAdded: [tool],
							timestamp: 1_700_000_002_500,
						},
						timestamp: 1_700_000_002_500,
					},
				],
			});

			const context = SessionManager.open(path).buildSessionContext();
			expect(context.model).toEqual({ provider: "openai", modelId: "gpt-test" });
			expect(context.messages.map((message) => message.role)).toEqual([
				"system",
				"compactionSummary",
				"user",
			]);
			expect(context.messages[0]).toMatchObject({
				sections: { preamble: "You are a coding agent." },
			});
			expect(context.messages[2]).toMatchObject({ content: "Second." });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an assistant's provider, model, usage and duration and an erroring tool result round-trip through SessionManager", () => {
		const dir = mkdtempSync(join(tmpdir(), "trpi-fixture-usage-"));
		try {
			const priced = fixtureUsage(1_200, 300, 0.42);
			const unpriced = fixtureUsage(800, 100, 0);
			const { path } = writeFixtureSession(dir, {
				id: "pin-usage-1",
				cwd: "/tmp/thinkrail-usage-pin",
				name: "Usage pin",
				messages: [
					{ role: "user", text: "Run the tests.", timestamp: 1_700_000_000_000 },
					{
						role: "assistant",
						content: [
							{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "bun test" } },
						],
						provider: "anthropic",
						model: "claude-sonnet-4-5",
						usage: priced,
						stopReason: "toolUse",
						timestamp: 1_700_000_001_000,
						durationMs: 900,
					},
					{
						role: "toolResult",
						toolCallId: "bash-1",
						toolName: "bash",
						content: [{ type: "text", text: "1 test failed" }],
						isError: true,
						timestamp: 1_700_000_002_000,
						durationMs: 650,
					},
					{
						role: "assistant",
						text: "One test fails.",
						provider: "claude-bridge",
						model: "claude-sonnet-4-5",
						usage: unpriced,
						timestamp: 1_700_000_003_000,
					},
				],
			});

			const manager = SessionManager.open(path);
			const info = manager.getEntries().find((entry) => entry.type === "session_info");
			expect(info?.timestamp).toBe(manager.getHeader()?.timestamp);
			const messages = manager.buildSessionContext().messages;
			expect(messages).toHaveLength(4);
			expect(messages[1]).toMatchObject({
				role: "assistant",
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				usage: priced,
				durationMs: 900,
				content: [{ type: "toolCall", id: "bash-1", name: "bash" }],
			});
			expect(messages[2]).toMatchObject({
				role: "toolResult",
				toolCallId: "bash-1",
				isError: true,
				durationMs: 650,
			});
			expect(messages[3]).toMatchObject({
				role: "assistant",
				provider: "claude-bridge",
				usage: unpriced,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a custom message lands as pi's custom_message entry in the conversation", () => {
		const dir = mkdtempSync(join(tmpdir(), "trpi-fixture-custom-"));
		try {
			const { path } = writeFixtureSession(dir, {
				id: "pin-custom-1",
				cwd: "/tmp/thinkrail-custom-pin",
				messages: [
					{ role: "user", text: "Build it in the background.", timestamp: 1_700_000_000_000 },
					{
						role: "custom",
						customType: "background-command-completion",
						text: "Finished background command bun run build (exit 0)",
						details: { delivery: "wake" },
						timestamp: 1_700_000_060_000,
					},
				],
			});
			const manager = SessionManager.open(path);
			const entry = manager.getEntries().find((candidate) => candidate.type === "custom_message");
			expect(entry).toMatchObject({
				customType: "background-command-completion",
				content: "Finished background command bun run build (exit 0)",
				details: { delivery: "wake" },
			});
			expect(manager.buildSessionContext().messages).toHaveLength(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a child transcript written under delegationSessionDirFor is the one pi-delegation finds for its parent", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "trpi-fixture-delegation-"));
		try {
			const { path } = writeFixtureSession(delegationSessionDirFor(dataDir, "ws-1", "parent-1"), {
				id: "child-1",
				cwd: "/tmp/thinkrail-delegation-pin",
				messages: [{ role: "user", text: "Investigate.", timestamp: 1_700_000_000_000 }],
			});

			expect(
				deriveChildSessionFile(join(dataDir, "delegation"), "ws-1", "parent-1", "child-1"),
			).toBe(path);
		} finally {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	test("default layout: no-arg discovery finds a fixture written under defaultSessionDirFor's encoded dir", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "trpi-fixture-agentdir-"));
		const previousEnv = process.env.PI_CODING_AGENT_DIR;
		try {
			const cwd = "/tmp/thinkrail-a5-pin-default";
			const sessionDir = defaultSessionDirFor(agentDir, cwd);
			const written = writeFixtureSession(sessionDir, {
				id: "pin-default-1",
				cwd,
				name: "Default layout pin",
				messages: [{ role: "user", text: "seed prompt", timestamp: 1_700_000_000_000 }],
			}).path;

			process.env.PI_CODING_AGENT_DIR = agentDir;
			const sessions = await SessionManager.list(cwd);

			expect(sessions).toHaveLength(1);
			expect(sessions[0]?.path).toBe(written);
			expect(sessions[0]).toMatchObject({
				id: "pin-default-1",
				cwd,
				name: "Default layout pin",
				messageCount: 1,
			});
		} finally {
			if (previousEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousEnv;
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	test("default layout: pi's real no-arg listAll() finds what HistoryIndex's own default walk must also find", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "trpi-fixture-listall-"));
		const previousEnv = process.env.PI_CODING_AGENT_DIR;
		try {
			const cwd = "/tmp/thinkrail-a5-pin-listall";
			const sessionDir = defaultSessionDirFor(agentDir, cwd);
			writeFixtureSession(sessionDir, {
				id: "pin-listall-1",
				cwd,
				messages: [{ role: "user", text: "seed prompt", timestamp: 1_700_000_000_000 }],
			});

			process.env.PI_CODING_AGENT_DIR = agentDir;
			const sessions = await SessionManager.listAll();

			expect(sessions.map((s) => s.id)).toContain("pin-listall-1");
		} finally {
			if (previousEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousEnv;
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});

test("pi records a new transcript's cwd in resolved spelling (stored directories rely on it)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-fixture-cwd-"));
	try {
		const cwd = resolve(dir, "repo");
		const sessionDir = join(dir, "sessions");
		const manager = SessionManager.create(`${cwd}${sep}.${sep}`, sessionDir);
		manager.appendMessage({ role: "user", content: "hello", timestamp: 1_700_000_000_000 });

		expect(manager.getCwd()).toBe(cwd);
		expect((await SessionManager.list(cwd, sessionDir)).map((info) => info.cwd)).toEqual([cwd]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
