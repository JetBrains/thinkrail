// Isolation guard — MUST be imported before anything that touches the pi runtime. ES imports hoist, so
// modules that import the server agent barrel import this file FIRST (see session.ts); pi reads
// PI_CODING_AGENT_DIR lazily (AuthStorage.create / SettingsManager.create at first use), so setting it at
// module-evaluation time in a fresh Playwright worker process is race-free. Same dir global-setup seeds
// with the user's auth copy + the pinned deterministic model — never the real ~/.pi/agent.
import { E2E_PI_AGENT_DIR } from "../../fixtures/paths";

process.env.PI_CODING_AGENT_DIR = E2E_PI_AGENT_DIR;
