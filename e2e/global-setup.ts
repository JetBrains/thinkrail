import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	E2E_DATA_DIR,
	E2E_FIXTURE_REPO,
	E2E_PI_AGENT_DIR,
	E2E_PI_MODELS_SEED,
	E2E_PICK_DIR_POINTER,
} from "./fixtures/paths";
import { seedFixtureRepo } from "./fixtures/repo";

/** Fresh, isolated state dir + a throwaway git repo to open as a project. (Runs under node, not bun.) */
export default function globalSetup(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	mkdirSync(E2E_DATA_DIR, { recursive: true });

	// Isolated pi agent dir: copy the user's provider/auth config so a real provider works (the `@agent`
	// suite needs it — auth lives across BOTH `auth.json` (OAuth providers) and `models.json` (providers
	// configured with an apiKey)), and pin a deterministic default model — so every run uses the *same*
	// known-current model rather than pi's "first available" (which depends on registry order + which
	// providers are authed, and could silently land on a deprecated one). A test's `setModel` then persists
	// *here*, never `~/.pi/agent`. Override for other auth/CI with THINKRAIL_E2E_MODEL="<provider>/<id>".
	mkdirSync(E2E_PI_AGENT_DIR, { recursive: true });
	// Source from a dev's relocated pi dir if they've set one, else the default ~/.pi/agent.
	const userAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	for (const file of ["auth.json", "models.json"]) {
		const src = join(userAgentDir, file);
		if (existsSync(src)) copyFileSync(src, join(E2E_PI_AGENT_DIR, file));
	}
	// Keep a pristine snapshot of the seeded models.json: the JetBrains AI spec mutates the shared agent-dir
	// copy (proxy wire/unwire), so `resetState` restores it per test (see E2E_PI_MODELS_SEED). No file means
	// the dev authed via auth.json only — reset then just clears any test-written models.json.
	const modelsSeedSrc = join(userAgentDir, "models.json");
	if (existsSync(modelsSeedSrc)) copyFileSync(modelsSeedSrc, E2E_PI_MODELS_SEED);
	else rmSync(E2E_PI_MODELS_SEED, { force: true });
	const [provider, ...idParts] = (
		process.env.THINKRAIL_E2E_MODEL ?? "anthropic/claude-opus-4-8"
	).split("/");
	writeFileSync(
		join(E2E_PI_AGENT_DIR, "settings.json"),
		`${JSON.stringify({ defaultProvider: provider, defaultModel: idParts.join("/"), defaultThinkingLevel: "low" }, null, 2)}\n`,
	);

	// Seed the shared fixture repo (git init + seed files + commit). Shared with per-test `resetState`, which
	// re-seeds it if a flaky @agent spec damages the repo (see fixtures/repo.ts).
	seedFixtureRepo();

	// Point the stubbed picker (its `THINKRAIL_PICK_DIR` names this file) at the git fixture by default;
	// a test can rewrite it to hand the picker a different folder without restarting the shared host.
	writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
}
