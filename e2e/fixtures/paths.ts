import { tmpdir } from "node:os";
import { join } from "node:path";

/** Isolated on-disk state for an e2e run — so tests never touch the user's real ~/.thinkrail. */
export const E2E_DATA_DIR = join(tmpdir(), "thinkrail-e2e");

/** Isolated HOME so cross-agent skill discovery never reads a developer's real personal libraries. */
export const E2E_HOME_DIR = join(E2E_DATA_DIR, "home");

/** A throwaway git repo (created in global setup) used as a "project" fixture. Lives under the data dir. */
export const E2E_FIXTURE_REPO = join(E2E_DATA_DIR, "sample-project");

/**
 * The compiled binary's cache root (`XDG_CACHE_HOME`) for the `e2e:binary` suite, so its web/skills
 * staging never touches the machine's real cache. Deliberately OUTSIDE `E2E_DATA_DIR`: staging happens
 * at server boot, and this must not depend on the wipe-then-seed order between global setup and the
 * webServer launch. Removed in global teardown instead, so every run still stages fresh.
 */
export const E2E_BINARY_CACHE = join(tmpdir(), "thinkrail-e2e-binary-cache");

/**
 * A dev/e2e control file the stubbed directory picker (`THINKRAIL_PICK_DIR`) points at: `selectDirectory`
 * returns the path written here, re-read per call. Global setup seeds it with `E2E_FIXTURE_REPO`; a test
 * can rewrite it to hand the picker a different folder without restarting the shared host. Safe only
 * because the suite is serial (`workers: 1`); parallelism would need a per-worker pointer.
 */
export const E2E_PICK_DIR_POINTER = join(E2E_DATA_DIR, "pick-dir");

/** A throwaway *non-git* folder used to exercise the "initialise a repo?" open flow. */
export const E2E_PLAIN_DIR = join(E2E_DATA_DIR, "plain-folder");

/**
 * A dev/e2e control file the stub `central` (JetBrains Central CLI) reads live per call to pick its outcome:
 * absent/empty → signed in (prints a secret); `needs-login` → empty secret (not signed in); `error` → a
 * non-zero exit. Lets a test drive the JetBrains AI card's not-signed-in / error branches without a real CLI,
 * mirroring the `E2E_PICK_DIR_POINTER` pattern. Safe only because the suite is serial (`workers: 1`).
 */
export const E2E_CENTRAL_STATE = join(E2E_DATA_DIR, "central-state");

/**
 * An isolated pi agent dir for the host (via `PI_CODING_AGENT_DIR`), so `@agent` tests that call
 * `setModel`/`setThinkingLevel` persist *here*, never the user's real `~/.pi/agent`. Global setup seeds it
 * with a copy of the user's `auth.json` + `models.json` (auth lives in both — OAuth providers vs. apiKey
 * providers) + a `settings.json` pinning a deterministic default model (override via
 * `THINKRAIL_E2E_MODEL=<provider>/<modelId>`).
 */
export const E2E_PI_AGENT_DIR = join(E2E_DATA_DIR, "pi-agent");

/**
 * A pristine snapshot of the seeded `models.json`, captured in global setup so per-test reset can restore
 * it. The in-app JetBrains AI spec connects/disconnects the jbcentral proxy, which rewrites the *shared*
 * agent-dir `models.json` — stripping the anthropic/openai `baseUrl`+`apiKey` that a proxy- or apiKey-authed
 * dev's `@agent` runs resolve their pinned model through — and leaves the host disconnected, so without a
 * restore every later `@agent` test finds an empty model registry. Absent when the user has no `models.json`
 * (auth via `auth.json` only); reset then just clears any test-written copy instead.
 */
export const E2E_PI_MODELS_SEED = join(E2E_DATA_DIR, "pi-agent-models.seed.json");
