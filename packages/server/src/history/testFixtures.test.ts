import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { defaultSessionDirFor, writeFixtureSession } from "./testFixtures";

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

	test("a tool call and its result round-trip through pi's context builder with details intact", () => {
		const dir = mkdtempSync(join(tmpdir(), "trpi-fixture-tools-"));
		try {
			const cwd = "/tmp/thinkrail-a5-pin-tools";
			const { path } = writeFixtureSession(dir, {
				id: "pin-tools-1",
				cwd,
				messages: [
					{ role: "user", text: "summarize", timestamp: 1_700_000_000_000 },
					{
						role: "assistant",
						text: "done",
						toolCalls: [{ id: "call-1", name: "offer_next_steps", arguments: { items: [] } }],
						timestamp: 1_700_000_001_000,
					},
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "offer_next_steps",
						text: "offered 1",
						details: { items: [{ label: "A", prompt: "do a" }] },
						timestamp: 1_700_000_002_000,
					},
				],
			});

			const { messages } = SessionManager.open(path, dir).buildSessionContext();

			const assistant = messages.find((message) => message.role === "assistant");
			if (assistant?.role !== "assistant") throw new Error("expected an assistant message");
			expect(assistant.content).toEqual([
				{ type: "text", text: "done" },
				{ type: "toolCall", id: "call-1", name: "offer_next_steps", arguments: { items: [] } },
			]);
			expect(assistant.stopReason).toBe("toolUse");

			const result = messages.find((message) => message.role === "toolResult");
			if (result?.role !== "toolResult") throw new Error("expected a tool result message");
			expect(result).toMatchObject({
				toolCallId: "call-1",
				toolName: "offer_next_steps",
				details: { items: [{ label: "A", prompt: "do a" }] },
				isError: false,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
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
