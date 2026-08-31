import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

test("a reload mid-stream does not duplicate the streaming assistant message", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	await page
		.getByTestId("chat-input")
		.fill(
			"Use the bash tool now to run `sleep 15; printf hydrated` exactly. " +
				"Do not answer until it finishes, then reply with one sentence.",
		);
	await page.getByTestId("chat-send").click();

	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	const bashActivity = page
		.locator(
			'[data-testid="activity-step"][data-tool="bash"], [data-testid="activity-group"], [data-testid="thinking-group"]',
		)
		.filter({ hasText: "bash" })
		.first();
	await expect(bashActivity).toBeVisible({ timeout: 60_000 });
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "true");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("project-item").first().click();
	await expect(worktreeRows(page).first()).toBeVisible({ timeout: 15_000 });
	await worktreeRows(page).first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1, {
		timeout: 30_000,
	});
	await expect(page.getByTestId("stream-indicator")).toBeVisible({ timeout: 10_000 });

	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false", {
		timeout: 120_000,
	});
	await expect(assistant).toHaveCount(1);
});
