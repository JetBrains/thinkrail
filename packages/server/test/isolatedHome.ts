import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "thinkrail-server-test-home-"));
process.env.HOME = home;
for (const name of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME", "PI_CODING_AGENT_DIR"])
	delete process.env[name];
afterAll(() => rmSync(home, { recursive: true, force: true }));
