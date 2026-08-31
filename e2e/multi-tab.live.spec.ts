import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	revealFirstProjectWorkspaces,
	worktreeRows,
} from "./fixtures/app";

test("a second tab reopens the same workspace chat and then sees live updates", {
	tag: "@agent",
}, async ({ page, context }) => {
	test.setTimeout(120_000);
	const done = (p: typeof page) =>
		p.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" });

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: alpha");
	await page.getByTestId("chat-send").click();
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: "alpha" }),
	).toBeVisible();
	await expect(done(page)).toBeVisible({ timeout: 80_000 });

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await worktreeRows(page2).first().getByRole("button").first().click();
	await page2.getByTestId("chat-history").first().click();
	await page2.getByTestId("closed-chat-item").first().click();

	await expect(
		page2.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: "alpha" }),
	).toBeVisible({ timeout: 30_000 });
	await expect(done(page2)).toHaveCount(0);

	await page.getByTestId("chat-input").fill("Now reply with the single word: bravo");
	await page.getByTestId("chat-send").click();
	await expect(done(page2)).toBeVisible({ timeout: 80_000 });
});
