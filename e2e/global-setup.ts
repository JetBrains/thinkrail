import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PI_AGENT_DIR } from "./fixtures/paths";

/** Fresh, isolated state dir + a throwaway git repo to open as a project. (Runs under node, not bun.) */
export default function globalSetup(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	mkdirSync(E2E_FIXTURE_REPO, { recursive: true });

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
	const [provider, ...idParts] = (
		process.env.THINKRAIL_E2E_MODEL ?? "anthropic/claude-opus-4-8"
	).split("/");
	writeFileSync(
		join(E2E_PI_AGENT_DIR, "settings.json"),
		`${JSON.stringify({ defaultProvider: provider, defaultModel: idParts.join("/"), defaultThinkingLevel: "low" }, null, 2)}\n`,
	);

	const git = (...args: string[]) =>
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, ...args], { stdio: "ignore" });
	git("init", "-b", "main");
	git("config", "user.email", "e2e@thinkrail.test");
	git("config", "user.name", "ThinkRail E2E");
	writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "# sample-project\n");
	// A non-markdown file so the editor suite can assert the source-only path (no rendered-view toggle).
	writeFileSync(join(E2E_FIXTURE_REPO, "notes.txt"), "plain-text-fixture\n");
	// A markdown file exercising GitHub-style alert callouts (+ a plain blockquote for contrast), for the
	// rendered-preview suite (see e2e/markdown-alerts.spec.ts).
	writeFileSync(
		join(E2E_FIXTURE_REPO, "ALERTS.md"),
		[
			"# Alert callouts",
			"",
			"> [!NOTE]",
			"> Useful information users should know.",
			"",
			"> [!TIP]",
			"> Helpful advice for doing things better.",
			"",
			"> [!IMPORTANT]",
			"> Key information to achieve a goal.",
			"",
			"> [!WARNING]",
			"> Urgent info needing immediate attention.",
			"",
			"> [!CAUTION]",
			"> Advises about risky outcomes.",
			"",
			"> A plain blockquote, no marker, so it stays a quote.",
			"",
		].join("\n"),
	);
	// A seed spec so the @agent `spec-tools` suite has a deterministic `spec_grep` match, proving the
	// bundled `pi-spec-graph` extension is wired into a live session (see e2e/spec-tools.live.spec.ts). The
	// token SPECGRAPHPROBE is distinctive so a match can't be an echo of the query; the file path it lives
	// in is the proof of a real hit.
	writeFileSync(
		join(E2E_FIXTURE_REPO, "SPEC.md"),
		"---\nid: sample-root\ntype: goal-and-requirements\ntitle: Sample Project\n---\n\n## Goal\n\nA throwaway fixture project for the thinkrail e2e suite. It carries the token SPECGRAPHPROBE so spec_grep has a deterministic match to find.\n",
	);
	// A child spec under the root, so the Specs viewer has a deterministic parent-tree to render
	// (see e2e/specs-panel.spec.ts).
	mkdirSync(join(E2E_FIXTURE_REPO, "module-a"), { recursive: true });
	writeFileSync(
		join(E2E_FIXTURE_REPO, "module-a", "SPEC.md"),
		"---\nid: sample-module\ntype: module-design\nstatus: active\ntitle: Sample Module\nparent: sample-root\n---\n\n## Responsibility\n\nA fixture module spec, child of sample-root.\n",
	);
	git("add", "-A");
	git("commit", "-m", "init");
}
