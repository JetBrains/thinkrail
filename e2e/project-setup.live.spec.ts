import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, waitForDone } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent end to end to prove the project-setup
// skill family works — the exact `/skill:project-setup` command the "Set up project" button seeds
// (WelcomePanel `SETUP_PROMPT`) force-loads the dispatcher, which routes an existing, un-specced codebase
// to `project-import` and drafts the first spec graph — proving the button's `/skill:project-setup` seed
// drives the flow on the programmatic `session.prompt` path.
//
// The shared fixture repo carries seed specs (global-setup), so we make *this workspace's* worktree look
// like a real un-specced project instead: drop the seed specs, add an AGENTS.md + a little source with a
// clear module boundary. The AGENTS.md is deliberately explicit so `project-import` can infer intent from
// the files and skip the interview (a headless run can't answer `ask_user_question`), which we also
// reinforce in the prompt args.
test("`/skill:project-setup` routes an existing codebase to import and drafts a spec graph", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(360_000); // real provider drafting a multi-file graph — well above the 30s default

	await openFixtureProject(page);
	const ws = await createWorkspaceViaDialog(page);
	const worktree = ws.worktreePath;

	// Make the worktree an un-specced codebase: remove the fixture's seed specs, seed agent-doc + source.
	rmSync(join(worktree, "SPEC.md"), { force: true });
	rmSync(join(worktree, "module-a"), { recursive: true, force: true });
	writeFileSync(
		join(worktree, "AGENTS.md"),
		[
			"# acme-widgets",
			"",
			"acme-widgets is a small command-line tool that batch-resizes images.",
			"",
			"## Modules",
			"- `src/cli` — argument parsing and the command entry point.",
			"- `src/resize` — the image-resizing pipeline (the core logic).",
			"",
			"`cli` calls `resize`; `resize` never imports `cli`.",
			"",
		].join("\n"),
	);
	mkdirSync(join(worktree, "src", "cli"), { recursive: true });
	mkdirSync(join(worktree, "src", "resize"), { recursive: true });
	writeFileSync(
		join(worktree, "src", "cli", "index.ts"),
		'import { resize } from "../resize";\n\n// Parse argv, then hand the files off to the resize pipeline.\nexport function main(argv: string[]): void {\n\tresize(argv);\n}\n',
	);
	writeFileSync(
		join(worktree, "src", "resize", "index.ts"),
		"// The image-resizing pipeline — the core domain. Never imports from cli.\nexport function resize(files: string[]): void {\n\tvoid files;\n}\n",
	);

	// The dialog set this workspace active on create; start a chat in it.
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);
	await page.getByTestId("start-chat").click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	// The SAME command the button seeds, plus a no-questions instruction so the interview can't block the
	// headless run (project-import is designed to proceed from the files when the user declines to answer).
	await page
		.getByTestId("chat-input")
		.fill(
			"/skill:project-setup This is an existing codebase with no specs. Derive everything from the files and draft the specs now — do not ask me any questions.",
		);
	await page.getByTestId("chat-send").click();

	// The command shows in the transcript — the same `/skill:project-setup` seed the button uses.
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "/skill:project-setup" }),
	).toBeVisible();

	await waitForDone(page, 320_000);

	// Outcome (DOM-stable, tool-order-agnostic): the import flow drafted the graph root on disk in the
	// worktree — proof it routed to project-import and followed its rails, without depending on expanding
	// a churning virtualized transcript. (Live spec-tool wiring is covered by spec-tools.live.spec.ts.)
	expect(existsSync(join(worktree, "goal-and-requirements.md"))).toBe(true);

	// And it's a well-formed spec the product renders: refresh the Specs rail → a goal-and-requirements
	// node appears (the `title` attribute carries `<id> · <type>`).
	await page.getByTestId("tab-specs").click();
	await page.getByTestId("specs-refresh").click();
	await expect(
		page.locator('[data-testid="spec-node"][title*="goal-and-requirements"]').first(),
	).toBeVisible();
});
