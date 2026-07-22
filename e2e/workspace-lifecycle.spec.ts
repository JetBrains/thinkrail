import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Two tabs on ONE host, no agent. Registry membership is backend-owned shared domain state (architecture
// #9), so a create/remove in one tab streams to the other via the workspace lifecycle pushes — every
// client (including the initiator) reacts identically, with no per-client optimism. Regression cover for
// issue #77: a workspace removed in one tab used to linger as a broken "zombie" row in the others.

test("workspace removal propagates — no zombie row in a second tab", async ({ page, context }) => {
	// Tab A: open the project + create a workspace (it becomes A's active workspace).
	await openFixtureProject(page);
	const created = await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);

	// Tab B: a second tab on the same host — expand the project (loads the list) + activate the workspace.
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page2.getByTestId("project-expand").first().click();
	await expect(page2.getByTestId("workspace-item")).toHaveCount(1);
	await page2.getByTestId("workspace-item").first().click();
	await expect(page2.getByTestId("workspace-item").first()).toHaveAttribute("data-active", "true");

	// Tab A: remove the workspace (confirm-popover → confirm).
	await page.getByTestId("workspace-item").first().hover();
	await page.getByTestId("workspace-item").first().getByTestId("workspace-remove").click();
	await page.getByTestId("confirm-remove").click();
	await expect(page.getByTestId("workspace-item")).toHaveCount(0);

	// Tab B converges purely by reacting to the `workspace.removed` push: the row disappears (no zombie),
	// and — since it was B's active workspace — B returns to the project's read-only view with a neutral toast.
	await expect(page2.getByTestId("workspace-item")).toHaveCount(0);
	await expect(page2.getByTestId("project-view")).toBeVisible();
	await expect(page2.getByTestId("toast").filter({ hasText: created.name })).toBeVisible();
});

test("workspace creation propagates to a second tab's rail", async ({ page, context }) => {
	// Tab A: open the project (no workspaces yet).
	await openFixtureProject(page);

	// Tab B: expand the project so its (empty) list is loaded — the precondition for folding in `created`.
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page2.getByTestId("project-expand").first().click();
	await expect(page2.getByTestId("workspace-item")).toHaveCount(0);

	// Tab A: create a workspace.
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);

	// Tab B sees it appear via the `workspace.created` push — no manual re-list, no focus stolen.
	await expect(page2.getByTestId("workspace-item")).toHaveCount(1);
});
