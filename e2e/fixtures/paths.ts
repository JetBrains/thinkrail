import { tmpdir } from "node:os";
import { join } from "node:path";

/** Isolated on-disk state for an e2e run — so tests never touch the user's real ~/.thinkrail. */
export const E2E_DATA_DIR = join(tmpdir(), "thinkrail-e2e");

/** A throwaway git repo (created in global setup) used as a "project" fixture. Lives under the data dir. */
export const E2E_FIXTURE_REPO = join(E2E_DATA_DIR, "sample-project");

/**
 * A dev/e2e control file the stubbed directory picker (`THINKRAIL_PICK_DIR`) points at: `selectDirectory`
 * returns the path written here, re-read per call. Global setup seeds it with `E2E_FIXTURE_REPO`; a test
 * can rewrite it to hand the picker a different folder without restarting the shared host.
 */
export const E2E_PICK_DIR_POINTER = join(E2E_DATA_DIR, "pick-dir");

/** A throwaway *non-git* folder used to exercise the "initialise a repo?" open flow. */
export const E2E_PLAIN_DIR = join(E2E_DATA_DIR, "plain-folder");

/**
 * An isolated pi agent dir for the host (via `PI_CODING_AGENT_DIR`), so `@agent` tests that call
 * `setModel`/`setThinkingLevel` persist *here*, never the user's real `~/.pi/agent`. Global setup seeds it
 * with a copy of the user's `auth.json` + `models.json` (auth lives in both — OAuth providers vs. apiKey
 * providers) + a `settings.json` pinning a deterministic default model (override via
 * `THINKRAIL_E2E_MODEL=<provider>/<modelId>`).
 */
export const E2E_PI_AGENT_DIR = join(E2E_DATA_DIR, "pi-agent");
