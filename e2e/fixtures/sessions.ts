// Seeds real, pi-parseable session JSONL files into the e2e host's isolated agent dir so `history.search`
// has something to find. Reuses `writeFixtureSession`/`defaultSessionDirFor` from
// `packages/server/src/history/testFixtures.ts` (a cross-package source import — this file runs under
// node via Playwright's own TS loading, same as the rest of `global-setup.ts`, and `testFixtures.ts` only
// imports `node:fs`/`node:path`, so this resolves cleanly with no bundler involved). Those two helpers are
// pinned against pi's real `SessionManager` by `packages/server/src/history/testFixtures.test.ts` — if
// pi's on-disk format or default-layout encoding ever shifts, that test fails, not this seeder silently.
import {
	defaultSessionDirFor,
	writeFixtureSession,
} from "../../packages/server/src/history/testFixtures";
import { E2E_PI_AGENT_DIR } from "./paths";

/** Deliberately **unmapped** cwd — no project/workspace record in the e2e fixtures maps to this path, so
 * search hits against it exercise `history.search`'s "no workspace/project scope labels" branch. */
export const E2E_EXTERNAL_CWD = "/tmp/thinkrail-e2e-external";

/** Deterministic base timestamp (ms since epoch) so recency order across the seeded fixtures is
 * assertable rather than depending on wall-clock write order. */
const BASE_TS = 1_700_000_000_000;

/**
 * Seeds two sessions for `E2E_EXTERNAL_CWD` under `agentDir`'s default per-cwd layout — the same layout
 * production `HistoryIndex` discovers via no-arg `SessionManager.listAll()` (see
 * `packages/server/src/history/SPEC.md`'s "pi file format" section), and the layout the e2e host actually
 * runs against (`PI_CODING_AGENT_DIR=E2E_PI_AGENT_DIR`, `playwright.config.ts`).
 *
 * Deterministic timestamps make recency order assertable — newest first:
 *  1. "update dependency pins" (its own session, `BASE_TS + 10_000`)
 *  2. "fix the flaky watcher test" (`BASE_TS + 2_000`)
 *  3. "deploy the docs site" (`BASE_TS`)
 *
 * The first session's second assistant reply contains the exact phrase "the debounce window overlaps" —
 * a fixed string later message-search specs can match on.
 */
export function seedExternalCwdSessions(agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = defaultSessionDirFor(agentDir, E2E_EXTERNAL_CWD);

	writeFixtureSession(dir, {
		id: "e2e-fixture-deploy-docs",
		cwd: E2E_EXTERNAL_CWD,
		messages: [
			{ role: "user", text: "deploy the docs site", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Deployed the docs site — all checks green.",
				timestamp: BASE_TS + 1_000,
			},
			{ role: "user", text: "fix the flaky watcher test", timestamp: BASE_TS + 2_000 },
			{
				role: "assistant",
				text: "Fixed it: the debounce window overlaps with the poll interval, so I widened it.",
				timestamp: BASE_TS + 3_000,
			},
		],
	});

	writeFixtureSession(dir, {
		id: "e2e-fixture-dependency-pins",
		cwd: E2E_EXTERNAL_CWD,
		messages: [{ role: "user", text: "update dependency pins", timestamp: BASE_TS + 10_000 }],
	});
}

/**
 * Seeds a session for a real workspace worktree cwd created during a test, using the same default-layout
 * encoding the e2e host's `HistoryIndex` discovers — for later tasks (A6+) that need searchable history
 * scoped to an actual workspace rather than the unmapped `E2E_EXTERNAL_CWD`.
 *
 * `opts.id` is optional and defaults (via `writeFixtureSession`) to a fresh `sess-<uuid>` per call — the
 * right choice for most tests, since it's what lets the *same* server process (one `webServer` lifetime
 * spans the whole Playwright run, including every `--repeat-each` repeat) attach each seeded session
 * without the "Unknown session" collision a fixed literal id causes once a second repeat's differently-
 * `workspaceId`'d attempt reuses it (see `AgentSessionManager`'s in-memory `sessions` map). Pass an
 * explicit `id` only when a test asserts against the literal id or otherwise needs it deterministic.
 *
 * @returns the resolved `id` and the written file's `path` (appendable, like `writeFixtureSession`
 * itself, e.g. to exercise mtime revalidation).
 */
export function seedWorkspaceSession(
	worktreePath: string,
	opts: Omit<Parameters<typeof writeFixtureSession>[1], "cwd">,
): { id: string; path: string } {
	const dir = defaultSessionDirFor(E2E_PI_AGENT_DIR, worktreePath);
	return writeFixtureSession(dir, { ...opts, cwd: worktreePath });
}
