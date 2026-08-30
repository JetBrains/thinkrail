import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, waitForAgentSettled } from "./fixtures/app";

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

	await page
		.getByTestId("chat-input")
		.fill(
			"/skill:setting-up-a-project This is an existing codebase with no specs. Derive everything from the files and draft the specs now — do not ask me any questions.",
		);
	await page.getByTestId("chat-send").click();

	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "/skill:setting-up-a-project" }),
	).toHaveCount(1);

	await waitForAgentSettled(page, 320_000);

	expect(hasGoalSpec(worktree)).toBe(true);

	await page.getByTestId("tab-specs").click();
	await page.getByTestId("specs-refresh").click();
	await expect(
		page.locator('[data-testid="spec-node"][title*="goal-and-requirements"]').first(),
	).toBeVisible();
});
