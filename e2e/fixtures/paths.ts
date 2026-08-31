import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_E2E_SHARDS } from "../shardPlan";
import { claimPortBlock, PORT_BLOCK_SLOTS, PORT_BLOCK_STRIDE } from "./portBlock";

const repoRoot = realpathSync(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const rootHash = createHash("sha256").update(repoRoot).digest("hex");

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

export const E2E_PORT = PORT_BASE;

export const E2E_BINARY_PORT = PORT_BASE + 2;

export const E2E_RESTART_PORT = PORT_BASE + 4;

export const E2E_DATA_DIR = join(tmpdir(), `thinkrail-e2e-${E2E_STATE_KEY}`);

export const E2E_HOME_DIR = join(E2E_DATA_DIR, "home");

export const E2E_FAKE_BIN_DIR = join(E2E_DATA_DIR, ".bun", "bin");

export const E2E_CENTRAL_EXTENSION_SOURCE = join(E2E_DATA_DIR, "synthetic-central-extension.ts");
export const E2E_CENTRAL_BAD_EXTENSION_SOURCE = join(
	E2E_DATA_DIR,
	"synthetic-central-extension-error.ts",
);

export const E2E_CENTRAL_ARTIFACT = join(
	E2E_HOME_DIR,
	".pi",
	"agent",
	"extensions",
	"jetbrains-central.ts",
);

export const E2E_CENTRAL_ARTIFACT_SEED = join(E2E_DATA_DIR, "real-central-extension.seed.ts");

export const E2E_FIXTURE_REPO = join(E2E_DATA_DIR, "sample-project");

export const E2E_BINARY_CACHE = join(tmpdir(), `thinkrail-e2e-binary-cache-${E2E_STATE_KEY}`);

export const E2E_DESKTOP_CACHE = join(tmpdir(), `thinkrail-e2e-desktop-cache-${E2E_STATE_KEY}`);

export const E2E_DESKTOP_READY_FILE = join(E2E_DATA_DIR, "desktop.ready.json");

export const E2E_DESKTOP_CONTROL_FILE = join(E2E_DATA_DIR, "desktop.control");

export const E2E_DESKTOP_USER_DATA = join(E2E_DATA_DIR, "desktop-user-data");

export const E2E_PICK_DIR_POINTER = join(E2E_DATA_DIR, "pick-dir");

export const E2E_PLAIN_DIR = join(E2E_DATA_DIR, "plain-folder");

export const E2E_CENTRAL_STATE = join(E2E_DATA_DIR, "central-state");

export const E2E_CENTRAL_LOG = join(E2E_DATA_DIR, "central-invocations.log");

export const E2E_SCREENSHOT_DIR = join(repoRoot, "e2e", "screenshots");

export const E2E_EDITOR_LOG = join(E2E_DATA_DIR, "editor-invocations.log");

export const E2E_PI_AGENT_DIR = join(E2E_DATA_DIR, "pi-agent");

export const E2E_PI_MODELS_SEED = join(E2E_DATA_DIR, "pi-agent-models.seed.json");

export const E2E_RESTART_DATA_DIR = join(tmpdir(), `thinkrail-e2e-restart-${E2E_STATE_KEY}`);

export const E2E_RESTART_HOST_LOG = join(
	tmpdir(),
	`thinkrail-e2e-restart-${E2E_STATE_KEY}-host.log`,
);
