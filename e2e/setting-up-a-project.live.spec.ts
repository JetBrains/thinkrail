import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, waitForAgentSettled } from "./fixtures/app";

const SETUP_SKILL = "setting-up-a-project";
const USER_REQUEST =
	"This is an existing codebase with no specs. Derive everything from the files and draft the specs now — do not ask me any questions.";
const SETUP_PROMPT = `/skill:${SETUP_SKILL} ${USER_REQUEST}`;

function hasGoalSpec(dir: string): boolean {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (hasGoalSpec(full)) return true;
		} else if (entry.name.endsWith(".md")) {
			if (/^type:\s*goal-and-requirements\s*$/m.test(readFileSync(full, "utf8").slice(0, 400))) {
				return true;
			}
		}
	}
	return false;
}

test("`/skill:setting-up-a-project` routes an existing codebase to import and drafts a spec graph", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(360_000);

	await openFixtureProject(page);
	const ws = await createWorkspaceViaDialog(page);
	const worktree = ws.worktreePath;

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

	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-input").fill(SETUP_PROMPT);
	await page.getByTestId("chat-send").click();

	const skillCard = page.getByTestId("skill-invocation-card");
	await expect(skillCard).toHaveCount(1);
	await expect(skillCard).toBeVisible();
	await expect(page.getByTestId("skill-invocation-name")).toHaveText(SETUP_SKILL);
	await expect(page.getByTestId("skill-user-request")).toHaveText(USER_REQUEST);

	await waitForAgentSettled(page, 320_000);

	expect(hasGoalSpec(worktree)).toBe(true);

	await page.getByTestId("tab-specs").click();
	await expect(page.getByRole("button", { name: "Refresh specs" })).toHaveCount(0);
	await expect(page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]')).toHaveCount(
		0,
	);
	await expect(
		page.locator('[data-testid="spec-node"][data-spec-type="goal-and-requirements"]').first(),
	).toBeVisible();
});
