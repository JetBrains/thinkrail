import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_E2E_SHARDS } from "../shardPlan";
import { claimPortBlock, PORT_BLOCK_SLOTS, PORT_BLOCK_STRIDE } from "./portBlock";

// ─── Per-worktree isolation ─────────────────────────────────────────────────────────────────────
// Every machine-global name the suites touch (tmp state dirs, listen ports) derives here from a
// stable per-worktree + optional shard-lane key. Different worktrees never collide, and one sharded
// invocation can run isolated hosts inside the same worktree. The key is deterministic (never random)
// because the Playwright runner, workers, global setup, and webServer each evaluate this module in
// separate processes and must still agree. Two complete invocations in one worktree remain sequential:
// stable lane ids deliberately reclaim interrupted state rather than leaking one namespace per run.

/** This worktree's repo root (this file lives at `<root>/e2e/fixtures/`). */
const repoRoot = realpathSync(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const rootHash = createHash("sha256").update(repoRoot).digest("hex");

/** Human-readable + collision-proof: `<sanitized basename>-<hash8>`, e.g. `workspace-16-1a2b3c4d`. */
const WORKTREE_KEY = `${basename(repoRoot).replace(/[^A-Za-z0-9._-]+/g, "-")}-${rootHash.slice(0, 8)}`;

function resolveLane(): number | undefined {
	const raw = process.env.THINKRAIL_E2E_LANE;
	if (raw === undefined || raw === "") return undefined;
	const lane = Number(raw);
	if (!Number.isInteger(lane) || lane < 0 || lane >= MAX_E2E_SHARDS) {
		throw new Error(
			`THINKRAIL_E2E_LANE must be an integer in [0, ${MAX_E2E_SHARDS - 1}], got ${JSON.stringify(raw)}`,
		);
	}
	return lane;
}

const E2E_LANE = resolveLane();
const E2E_STATE_KEY =
	E2E_LANE === undefined ? WORKTREE_KEY : `${WORKTREE_KEY}-lane-${E2E_LANE + 1}`;
const claimKey = E2E_LANE === undefined ? repoRoot : `${repoRoot}#e2e-lane-${E2E_LANE}`;
const claimHash = createHash("sha256").update(claimKey).digest("hex");

/**
 * Per-lane port block, [25000, 29990] — clear of the dev host's 24242 and the OS-ephemeral range.
 * The atomic registry distinguishes shard lanes by logical key while using the real worktree path
 * for liveness, so lanes and worktrees cannot collide. THINKRAIL_E2E_PORT_BASE bypasses the registry;
 * in a sharded run it pins lane zero and each later lane takes the next block.
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
		return base + (E2E_LANE ?? 0) * PORT_BLOCK_STRIDE;
	}
	return claimPortBlock(
		E2E_LANE === undefined ? repoRoot : { key: claimKey, livenessPath: repoRoot },
		Number.parseInt(claimHash.slice(0, 8), 16) % PORT_BLOCK_SLOTS,
	);
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
export const E2E_DATA_DIR = join(tmpdir(), `thinkrail-e2e-${E2E_STATE_KEY}`);

/** Isolated HOME so cross-agent skill discovery never reads a developer's real personal libraries. */
export const E2E_HOME_DIR = join(E2E_DATA_DIR, "home");

/** Lane-local command stubs. Keeping Central here lets one lane simulate absence without touching another. */
export const E2E_FAKE_BIN_DIR = join(E2E_DATA_DIR, "bin");

/** Independently authored external PI extension sources materialized by the stateful Central fake. */
export const E2E_CENTRAL_EXTENSION_SOURCE = join(E2E_DATA_DIR, "synthetic-central-extension.ts");
export const E2E_CENTRAL_BAD_EXTENSION_SOURCE = join(
	E2E_DATA_DIR,
	"synthetic-central-extension-error.ts",
);

/** Global Central artifact path: deliberately under HOME, independent of PI_CODING_AGENT_DIR. */
export const E2E_CENTRAL_ARTIFACT = join(
	E2E_HOME_DIR,
	".pi",
	"agent",
	"extensions",
	"jetbrains-central.ts",
);

/** A throwaway git repo (created in global setup) used as a "project" fixture. Lives under the data dir. */
export const E2E_FIXTURE_REPO = join(E2E_DATA_DIR, "sample-project");

/**
 * The compiled binary's cache root (`XDG_CACHE_HOME`) for the `e2e:binary` suite, so its web/skills
 * staging never touches the machine's real cache. Deliberately OUTSIDE `E2E_DATA_DIR`: staging happens
 * at server boot, and this must not depend on the wipe-then-seed order between global setup and the
 * webServer launch. Removed in global teardown instead, so every run still stages fresh.
 */
export const E2E_BINARY_CACHE = join(tmpdir(), `thinkrail-e2e-binary-cache-${E2E_STATE_KEY}`);

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
 * Live control file for the independently authored Central fake. Empty means supported/ready; named states
 * drive version, action, postcondition, and candidate-loading failures without copying Central behavior.
 */
export const E2E_CENTRAL_STATE = join(E2E_DATA_DIR, "central-state");

/** Reviewed argv log from the Central fake; contains arguments only, never action output or secrets. */
export const E2E_CENTRAL_LOG = join(E2E_DATA_DIR, "central-invocations.log");

/**
 * Where screenshot-capturing specs write their PNGs, one subdirectory per group (`fixtures/screenshots.ts`).
 * Deliberately repo-local (and gitignored) rather than under the per-lane data dir: these are review
 * evidence a developer opens by hand, so the path must be the same on every run. Names are unique per
 * scenario, so a rerun overwrites its own files in place.
 */
export const E2E_SCREENSHOT_DIR = join(repoRoot, "e2e", "screenshots");

/**
 * Where the stub `code` (the "Open in VS Code" fake, `fixtures/bin/code`) appends each invocation's
 * argv, one line per call — so a test can assert the workspace row's "Open in" actually launched with
 * the right worktree path, without a real VS Code install. Absent until the stub first runs.
 */
export const E2E_EDITOR_LOG = join(E2E_DATA_DIR, "editor-invocations.log");

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
 * it after any provider test. Central never edits this shared agent-dir file; restoring the isolated baseline
 * keeps later `@agent` runs independent. Absent when the user has no
 * `models.json` (auth via `auth.json` only); reset then just clears any test-written copy instead.
 */
export const E2E_PI_MODELS_SEED = join(E2E_DATA_DIR, "pi-agent-models.seed.json");

/**
 * The restart spec's private, self-managed state dir (`ask-restart.live.spec.ts` seeds and wipes it
 * itself — deliberately outside `E2E_DATA_DIR`, whose lifecycle the shared global setup/teardown owns).
 */
export const E2E_RESTART_DATA_DIR = join(tmpdir(), `thinkrail-e2e-restart-${E2E_STATE_KEY}`);

/** Outside the restart data dir so a failed run's per-test wipe doesn't destroy the post-mortem trail. */
export const E2E_RESTART_HOST_LOG = join(
	tmpdir(),
	`thinkrail-e2e-restart-${E2E_STATE_KEY}-host.log`,
);
