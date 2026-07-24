// Isolation guard — MUST be imported before anything that touches the pi runtime. ES imports hoist, so
// modules that import the server agent barrel import this file FIRST (see session.ts); pi reads
// PI_CODING_AGENT_DIR lazily (ModelRuntime.create / SettingsManager.create at first use), so setting it at
// module-evaluation time in a fresh Playwright worker process is race-free.
//
// PER-WORKER clone: each Playwright worker process gets its OWN pi-agent dir, cloned from the one
// global-setup seeds with the user's auth copy + the pinned deterministic model (never the real
// ~/.pi/agent). Sharing one dir across workers let processes interact through `sessions/`: a dying
// worker's session dispose overlapped the next worker's newborn session in the SAME tree, and one
// failure cascaded into ENOENT crashes for every later live-session test. A pid-suffixed clone makes
// cross-process interaction impossible by construction; the throwaway clones die with E2E_DATA_DIR.
//
// HOME + vendor-home isolation: HOME and the vendor config-dir env vars point at an isolated home so
// portable skill discovery never reads a developer's personal libraries.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { E2E_HOME_DIR, E2E_PI_AGENT_DIR } from "../../fixtures/paths";

const workerAgentDir = `${E2E_PI_AGENT_DIR}-w${process.pid}`;
mkdirSync(workerAgentDir, { recursive: true });
for (const file of ["auth.json", "models.json", "settings.json"]) {
	const src = join(E2E_PI_AGENT_DIR, file);
	if (existsSync(src)) copyFileSync(src, join(workerAgentDir, file));
}

process.env.HOME = E2E_HOME_DIR;
process.env.CLAUDE_CONFIG_DIR = `${E2E_HOME_DIR}/.claude`;
process.env.CODEX_HOME = `${E2E_HOME_DIR}/.codex`;
process.env.GEMINI_CLI_HOME = E2E_HOME_DIR;
process.env.PI_CODING_AGENT_DIR = workerAgentDir;
