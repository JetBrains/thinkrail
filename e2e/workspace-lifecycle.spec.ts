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

test("removing the active workspace restores the previously selected workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	const previous = await createWorkspaceViaDialog(page);
	const removed = await createWorkspaceViaDialog(page);
	const previousRow = worktreeRows(page).filter({ hasText: previous.name });
	const removedRow = worktreeRows(page).filter({ hasText: removed.name });

	await previousRow.getByRole("button").first().click();
	await removedRow.getByRole("button").first().click();
	await expect(removedRow).toHaveAttribute("data-active", "true");

	await openWorkspaceMenu(removedRow);
	await page.getByTestId("workspace-remove").click();
	await page.getByTestId("confirm-remove").click();

	await expect(removedRow).toHaveCount(0);
	await expect(previousRow).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("welcome")).toHaveCount(0);
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
