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
process.env.USERPROFILE = E2E_HOME_DIR;
process.env.CLAUDE_CONFIG_DIR = `${E2E_HOME_DIR}/.claude`;
process.env.CODEX_HOME = `${E2E_HOME_DIR}/.codex`;
process.env.GEMINI_CLI_HOME = E2E_HOME_DIR;
process.env.PI_CODING_AGENT_DIR = workerAgentDir;
