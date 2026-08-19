import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	E2E_CENTRAL_BAD_EXTENSION_SOURCE,
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_CENTRAL_STATE,
	E2E_DATA_DIR,
	E2E_FAKE_BIN_DIR,
	E2E_FIXTURE_REPO,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PI_MODELS_SEED,
	E2E_PICK_DIR_POINTER,
} from "./fixtures/paths";
import { seedFixtureRepo } from "./fixtures/repo";
import { seedExternalCwdSessions } from "./fixtures/sessions";
import { seedTemplateFixtures } from "./fixtures/templates";

/** Fresh, isolated state dir + a throwaway git repo to open as a project. (Runs under node, not bun.) */
export default function globalSetup(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	mkdirSync(E2E_DATA_DIR, { recursive: true });
	mkdirSync(E2E_HOME_DIR, { recursive: true });
	// An empty HOME makes zsh launch its interactive first-run wizard, which consumes the terminal test's
	// first keystrokes instead of running them. A real (minimal) rc file keeps the isolated shell inert.
	writeFileSync(join(E2E_HOME_DIR, ".zshrc"), "# ThinkRail e2e isolated shell\n");

	// Terminal PTYs spawn the developer's `$SHELL` against this isolated HOME. zsh reads a HOME with no rc
	// files as a brand-new install and blocks the terminal on its interactive `zsh-newuser-install` wizard
	// ("--- Type one of the keys in parentheses ---"), which then swallows every keystroke a terminal test
	// sends. Seeding empty rc files makes an interactive shell start silently with a predictable prompt,
	// whichever shell the developer runs — so terminal specs don't depend on the host's dotfiles.
	for (const rc of [".zshrc", ".bashrc"]) writeFileSync(join(E2E_HOME_DIR, rc), "");

	// Lane-local stubs: one lane can remove Central without mutating a repo file shared across shards.
	mkdirSync(E2E_FAKE_BIN_DIR, { recursive: true });
	for (const command of ["central", "code"]) {
		const target = join(E2E_FAKE_BIN_DIR, command);
		copyFileSync(new URL(`./fixtures/bin/${command}`, import.meta.url), target);
		chmodSync(target, 0o755);
	}
	copyFileSync(
		new URL("./fixtures/central-extension.ts.fixture", import.meta.url),
		E2E_CENTRAL_EXTENSION_SOURCE,
	);
	copyFileSync(
		new URL("./fixtures/central-extension-error.ts.fixture", import.meta.url),
		E2E_CENTRAL_BAD_EXTENSION_SOURCE,
	);
	writeFileSync(E2E_CENTRAL_STATE, "");

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
	// Snapshot the seeded models.json so `resetState` can restore the provider baseline per test.
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

	// Seed two deterministic pi sessions for a deliberately unmapped cwd, under the SAME default per-cwd
	// layout production `HistoryIndex` discovers (see fixtures/sessions.ts + history/SPEC.md's "pi file
	// format" section) — so `history.search` has real, searchable history the moment the host boots.
	seedExternalCwdSessions();

	// Seed a global-scope prompt template (`prompts/review.md`) so `template.list`/`template.get` — and the
	// composer's `/` menu (Task B5) — have something real to discover. `resetState` never wipes
	// `pi-agent/prompts/`, so one seed here covers the whole suite (see fixtures/templates.ts).
	seedTemplateFixtures();

	// Seed the shared fixture repo (git init + seed files + commit). Shared with per-test `resetState`, which
	// re-seeds it if a flaky @agent spec damages the repo (see fixtures/repo.ts).
	seedFixtureRepo();

	// Point the stubbed picker (its `THINKRAIL_PICK_DIR` names this file) at the git fixture by default;
	// a test can rewrite it to hand the picker a different folder without restarting the shared host.
	writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
}
