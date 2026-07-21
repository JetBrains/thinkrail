import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, stageHookProject } from "./fixtures/app";

// Real host, real git commits to the project's root checkout, real `sh -c` subprocess — no agent needed.

test.describe("project hooks config", () => {
	test("the gear icon and the Welcome 'Configure hooks' card both open the dialog with zero workspaces", async ({
		page,
	}) => {
		stageHookProject({});
		await page.goto("/");
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		// Welcome card, reachable before any workspace exists.
		await page.getByTestId("welcome-action").filter({ hasText: "Configure hooks" }).click();
		await expect(page.getByTestId("project-hooks-dialog")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("project-hooks-dialog")).not.toBeVisible();

		// Gear icon on the project row.
		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await expect(page.getByTestId("project-hooks-dialog")).toBeVisible();
	});

	test("saving a committed onCreate command actually takes effect for a workspace created afterward", async ({
		page,
	}) => {
		stageHookProject({});
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await page.getByTestId("hook-command-onCreate").fill("echo configured-via-ui");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("project-hooks-dialog")).not.toBeVisible();

		await createWorkspaceViaDialog(page);
		const badge = page.getByTestId("workspace-item").first().getByTestId("workspace-hook-badge");
		await expect(badge).toHaveAttribute("data-hook-status", "awaitingApproval");
	});

	test("toggling a host-local override persists independently of the committed command", async ({
		page,
	}) => {
		stageHookProject({ onCreate: "echo committed" });
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await page.getByTestId("hook-override-toggle-onCreate").check();
		await page.getByTestId("hook-override-onCreate").fill("echo overridden");
		await page.getByTestId("save-hooks").click();
		await expect(page.getByTestId("project-hooks-dialog")).not.toBeVisible();

		// Re-open and confirm it round-tripped.
		await page.getByTestId("project-item").first().hover();
		await page.getByTestId("project-hooks").click();
		await expect(page.getByTestId("hook-override-toggle-onCreate")).toBeChecked();
		await expect(page.getByTestId("hook-override-onCreate")).toHaveValue("echo overridden");
		await expect(page.getByTestId("hook-command-onCreate")).toHaveValue("echo committed");
	});

	test("removing a workspace with an unapproved onDelete surfaces a toast instead of failing silently", async ({
		page,
	}) => {
		stageHookProject({ onCreate: "true", onDelete: "echo tearing-down" });
		await page.goto("/");
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();
		await expect(page.getByTestId("project-item").first()).toBeVisible();

		// Approve onCreate only (via the reactive badge flow), leaving onDelete unapproved.
		await createWorkspaceViaDialog(page);
		const row = page.getByTestId("workspace-item").first();
		const badge = row.getByTestId("workspace-hook-badge");
		await expect(badge).toHaveAttribute("data-hook-status", "awaitingApproval");
		await badge.click();
		await page.getByTestId("confirm-approve-hook").click();
		await expect(badge).toHaveAttribute("data-hook-status", "succeeded", { timeout: 10_000 });

		// Remove it — onDelete was never approved, so it should be skipped, and the skip should be visible.
		await row.getByTestId("workspace-remove").click();
		await page.getByTestId("confirm-remove").click();
		await expect(
			page.getByTestId("toast").filter({ hasText: "onDelete" }).filter({ hasText: "approval" }),
		).toBeVisible({ timeout: 10_000 });
	});
});
