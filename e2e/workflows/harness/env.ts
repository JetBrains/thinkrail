import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { toolHomeEnv } from "@thinkrail/shared/toolHomes";
import { E2E_HOME_DIR, E2E_PI_AGENT_DIR } from "../../fixtures/paths";

const workerAgentDir = `${E2E_PI_AGENT_DIR}-w${process.pid}`;
mkdirSync(workerAgentDir, { recursive: true });
for (const file of ["auth.json", "models.json", "settings.json"]) {
	const src = join(E2E_PI_AGENT_DIR, file);
	if (existsSync(src)) copyFileSync(src, join(workerAgentDir, file));
}

Object.assign(process.env, toolHomeEnv(E2E_HOME_DIR));
process.env.PI_CODING_AGENT_DIR = workerAgentDir;
