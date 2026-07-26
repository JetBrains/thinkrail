import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimPortBlock, PORT_BLOCK_SLOTS } from "./portBlock";

// ─── Per-worktree isolation ─────────────────────────────────────────────────────────────────────
// Every machine-global name the suites touch (tmp state dirs, listen ports) derives here from a
// stable per-worktree key, so parallel e2e runs from DIFFERENT worktrees never collide — they used
// to share `$TMPDIR/thinkrail-e2e` + fixed ports, letting one run's global setup/teardown wipe a
// sibling run's live host state. Within ONE worktree the suites still share these paths and stay
// sequential (see playwright.binary.config.ts). The key is deterministic (path-derived, never
// random) because the Playwright runner, its workers, and global setup each evaluate this module
// independently and must all agree on the same paths and ports; the port block additionally rides
// a persistent atomic claim (portBlock.ts), which is stable across processes AND runs for the
// same worktree while guaranteeing distinct blocks for distinct live worktrees.

/** This worktree's repo root (this file lives at `<root>/e2e/fixtures/`). */
const repoRoot = realpathSync(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const rootHash = createHash("sha256").update(repoRoot).digest("hex");

/** Human-readable + collision-proof: `<sanitized basename>-<hash8>`, e.g. `workspace-16-1a2b3c4d`. */
const WORKTREE_KEY = `${basename(repoRoot).replace(/[^A-Za-z0-9._-]+/g, "-")}-${rootHash.slice(0, 8)}`;

/**
 * Per-worktree port block, [25000, 29990] — clear of the dev host's 24242 and the OS-ephemeral
 * range. The path hash picks the *preferred* slot; actual ownership is arbitrated by the atomic
 * claim registry (see portBlock.ts), so two worktrees whose hashes collide still get distinct
 * blocks — no manual coordination. THINKRAIL_E2E_PORT_BASE bypasses the registry and pins the
 * block explicitly (invalid values throw: loud beats silently colliding). The offsets below keep
 * one worktree's suites apart within its block.
 */
function resolvePortBase(): number {
	const env = process.env.THINKRAIL_E2E_PORT_BASE;
	if (env !== undefined && env !== "") {
		const base = Number(env);
		if (!Number.isInteger(base) || base < 1024 || base > 65000) {
			throw new Error(
				`THINKRAIL_E2E_PORT_BASE must be an integer in [1024, 65000], got ${JSON.stringify(env)}`,
			);
		}
		return base;
	}
	return claimPortBlock(repoRoot, Number.parseInt(rootHash.slice(0, 8), 16) % PORT_BLOCK_SLOTS);
}
const PORT_BASE = resolvePortBase();

/** The shared-host browser suites' port (`playwright.config.ts` — the dev host binds it exactly). */
export const E2E_PORT = PORT_BASE;

/** The compiled-binary suite's port (`playwright.binary.config.ts`). */
export const E2E_BINARY_PORT = PORT_BASE + 2;

/** The self-hosting restart spec's private-host port (`ask-restart.live.spec.ts`). */
export const E2E_RESTART_PORT = PORT_BASE + 4;

/**
 * Isolated on-disk state for an e2e run — per-worktree, so tests never touch the user's real
 * ~/.thinkrail and parallel runs from different worktrees never touch each other.
 */
export const E2E_DATA_DIR = join(tmpdir(), `thinkrail-e2e-${WORKTREE_KEY}`);

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
export const E2E_BINARY_CACHE = join(tmpdir(), `thinkrail-e2e-binary-cache-${WORKTREE_KEY}`);

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

/**
 * The restart spec's private, self-managed state dir (`ask-restart.live.spec.ts` seeds and wipes it
 * itself — deliberately outside `E2E_DATA_DIR`, whose lifecycle the shared global setup/teardown owns).
 */
export const E2E_RESTART_DATA_DIR = join(tmpdir(), `thinkrail-e2e-restart-${WORKTREE_KEY}`);

/** Outside the restart data dir so a failed run's per-test wipe doesn't destroy the post-mortem trail. */
export const E2E_RESTART_HOST_LOG = join(
	tmpdir(),
	`thinkrail-e2e-restart-${WORKTREE_KEY}-host.log`,
);
