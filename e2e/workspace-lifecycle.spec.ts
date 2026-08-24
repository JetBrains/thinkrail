import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openWorkspaceMenu,
	revealFirstProjectWorkspaces,
	worktreeRows,
} from "./fixtures/app";

test("workspace removal propagates — no zombie row in a second tab", async ({ page, context }) => {
	await openFixtureProject(page);
	const created = await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await expect(worktreeRows(page2)).toHaveCount(1);
	await worktreeRows(page2).first().click();
	await expect(worktreeRows(page2).first()).toHaveAttribute("data-active", "true");

	await openWorkspaceMenu(worktreeRows(page).first());
	await page.getByTestId("workspace-remove").click();
	await page.getByTestId("confirm-remove").click();
	await expect(worktreeRows(page)).toHaveCount(0);

	await expect(worktreeRows(page2)).toHaveCount(0);
	await expect(page2.getByTestId("welcome")).toBeVisible();
	await expect(page2.getByTestId("toast").filter({ hasText: created.name })).toBeVisible();
});

test("workspace creation propagates to a second tab's rail", async ({ page, context }) => {
	await openFixtureProject(page);

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await expect(worktreeRows(page2)).toHaveCount(0);

	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);

	await expect(worktreeRows(page2)).toHaveCount(1);
});
