import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): the Skills-reload badge lives in the chat header, so it needs
// a real session. No prompt is ever sent — the session only has to exist — so this stays fast and never
// spends provider tokens (session create + session.reloadResources are config/fs work, no model round-trip).
//
// The bugs this pins: watcher startup must not look like a skill change, and the badge must remain
// store-derived per session across CenterTabs remounts. A reload clears it for good and a sibling chat that
// loaded the current skills is never flagged.
test("skills badge: flags a worktree skill change, clears on reload, and survives a tab switch", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const worktree = workspace.worktreePath;

	// Chat A — its header carries the Skills trigger. No prompt sent, so it never streams (Reload stays enabled).
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const skillsBtn = page.getByTestId("open-skills");
	await expect(skillsBtn).toBeVisible();

	// Session creation waits for the lazy watcher's one-shot wildcard before loading skills. The startup
	// uncertainty is therefore part of this chat's baseline and must NOT leave the new chat stale. Opening
	// Files also proves ordinary live readers still work without another delayed startup.
	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
	await page.waitForTimeout(1200);
	await expect(skillsBtn).not.toHaveAttribute("data-stale", "true");

	// A skill file appears on disk (a pull/branch/edit) → the loaded session is flagged for a reload.
	mkdirSync(join(worktree, ".claude", "skills", "demo"), { recursive: true });
	writeFileSync(
		join(worktree, ".claude", "skills", "demo", "SKILL.md"),
		"---\nname: demo\ndescription: e2e demo skill\n---\n\nDemo skill written mid-session by the e2e suite.\n",
	);
	await expect(skillsBtn).toHaveAttribute("data-stale", "true", { timeout: 15_000 });

	// Reload from the dialog applies the change to this chat and clears the badge for good.
	await skillsBtn.click();
	await expect(page.getByTestId("skills-stale")).toBeVisible();
	await page.getByTestId("skills-reload").click();
	await expect(page.getByTestId("skills-stale")).toBeHidden({ timeout: 15_000 });
	await page.keyboard.press("Escape");
	await expect(skillsBtn).not.toHaveAttribute("data-stale", "true");

	// A second chat loads the current skills → not flagged (staleness is per session, not per workspace).
	await page.getByTestId("new-chat").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	await expect(page.getByTestId("open-skills")).toBeVisible();
	await expect(page.getByTestId("open-skills")).not.toHaveAttribute("data-stale", "true");

	// The regression: switch back to chat A. A fresh ChatView mount must read the reloaded (cleared) state
	// from the store, NOT re-raise the badge off the persisted fs signal the way the old per-mount state did.
	await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.first()
		.locator("button")
		.first()
		.click();
	await expect(page.getByTestId("open-skills")).toBeVisible();
	await expect(page.getByTestId("open-skills")).not.toHaveAttribute("data-stale", "true");
});
