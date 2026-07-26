import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { defaultSessionDirFor, writeFixtureSession } from "./testFixtures";

/**
 * `writeFixtureSession` (and its sibling `defaultSessionDirFor`) exist to fake pi's on-disk session
 * format well enough to fool pi's *real* `SessionManager` — never a hand-rolled parser. These tests are
 * the tripwire: if pi's format or discovery layout ever shifts on a version bump, one of these fails
 * here, loudly, instead of the e2e suite (or `HistoryIndex`) mysteriously finding zero sessions.
 *
 * Two discovery layouts exist (see SPEC.md's "pi file format" section):
 *  - explicit `sessionDir` (`HistoryIndex`'s constructor, and this module's other tests) → flat,
 *    non-recursive `readdir` of that exact dir.
 *  - no-arg (`getHistoryIndex()`'s production default, and the e2e host's `PI_CODING_AGENT_DIR`) → walks
 *    `${agentDir}/sessions/<encoded-cwd>/` one level deep. This is the layout the e2e suite actually
 *    relies on, so it gets its own pinning case below.
 */
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

			// `getAgentDir()` (and therefore the no-arg default sessions root) reads `PI_CODING_AGENT_DIR`
			// fresh on every call — verified by reading pi's `config.js`, not cached at module load — so
			// setting it immediately before the call and restoring it in `finally` is sufficient; no
			// subprocess needed to observe a "live" env read.
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

	// `HistoryIndex` no longer calls `listAll()` (it walks the layout itself — see SPEC.md), so this now
	// pins the *layout facts* both walkers share: what pi's real discovery sees is what ours must see.
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
