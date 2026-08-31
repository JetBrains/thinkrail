import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("skills badge: ignores capped build churn, flags a skill change, and clears per chat", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const worktree = workspace.worktreePath;

	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const skillsBtn = page.getByTestId("open-skills");
	await expect(skillsBtn).toBeVisible();

	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
	await page.waitForTimeout(1200);
	await expect(skillsBtn).not.toHaveAttribute("data-stale", "true");

	const generated = join(worktree, "generated-build");
	mkdirSync(generated, { recursive: true });
	for (let i = 0; i < 150; i += 1) {
		writeFileSync(join(generated, `chunk-${i}.js`), `export const chunk = ${i};\n`);
	}
	await expect(page.getByTestId("file-node").filter({ hasText: "generated-build" })).toBeVisible({
		timeout: 15_000,
	});
	await expect(skillsBtn).not.toHaveAttribute("data-stale", "true");

	mkdirSync(join(worktree, ".claude", "skills", "demo"), { recursive: true });
	writeFileSync(
		join(worktree, ".claude", "skills", "demo", "SKILL.md"),
		"---\nname: demo\ndescription: e2e demo skill\n---\n\nDemo skill written mid-session by the e2e suite.\n",
	);
	await expect(skillsBtn).toHaveAttribute("data-stale", "true", { timeout: 15_000 });

	await skillsBtn.click();
	await expect(page.getByTestId("skills-stale")).toBeVisible();
	await page.getByTestId("skills-reload").click();
	await expect(page.getByTestId("skills-stale")).toBeHidden({ timeout: 15_000 });
	await page.keyboard.press("Escape");
	await expect(skillsBtn).not.toHaveAttribute("data-stale", "true");

	await page.getByTestId("new-chat").first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	await expect(page.getByTestId("open-skills")).toBeVisible();
	await expect(page.getByTestId("open-skills")).not.toHaveAttribute("data-stale", "true");

	await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.first()
		.locator("button")
		.first()
		.click();
	await expect(page.getByTestId("open-skills")).toBeVisible();
	await expect(page.getByTestId("open-skills")).not.toHaveAttribute("data-stale", "true");
});
