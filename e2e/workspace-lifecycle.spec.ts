import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openAppFresh, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

// Two tabs on ONE host, no agent. Registry membership is backend-owned shared domain state (architecture
// #9), so a create/remove in one tab streams to the other via the workspace lifecycle pushes — every
// client (including the initiator) reacts identically, with no per-client optimism. Regression cover for
// issue #77: a workspace removed in one tab used to linger as a broken "zombie" row in the others.
// Project open/remove is the same shape via `project.opened` / `project.removed`.

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
	// and — since it was B's active workspace — B returns to the Welcome screen with a neutral toast.
	await expect(page2.getByTestId("workspace-item")).toHaveCount(0);
	await expect(page2.getByTestId("welcome")).toBeVisible();
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

// Project registry membership is shared domain state too: without `project.opened`, Tab B never saw a
// project opened in Tab A; without `project.removed`, Tab B kept an empty ghost project row after remove.

test("project open propagates to a second tab's rail", async ({ page, context }) => {
	const projectName = basename(E2E_FIXTURE_REPO);

	// Tab A + Tab B start on a clean host (no projects).
	await openAppFresh(page);
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page2.getByTestId("project-item")).toHaveCount(0);

	// Tab A: open the fixture project via the stubbed picker.
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").filter({ hasText: projectName })).toBeVisible();

	// Tab B sees it via `project.opened` — no reload, no focus stolen (selection stays Tab A's).
	await expect(page2.getByTestId("project-item").filter({ hasText: projectName })).toBeVisible();
});

test("project removal propagates — no ghost project row in a second tab", async ({
	page,
	context,
}) => {
	const projectName = basename(E2E_FIXTURE_REPO);

	// Tab A: open the project + create a workspace so removal has children.
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const projectRowA = page.getByTestId("project-item").filter({ hasText: projectName });
	await expect(projectRowA).toBeVisible();
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);

	// Tab B: same host — project visible, expand so workspaces are loaded (the ghost case is project
	// still listed after workspaces go).
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	const projectRowB = page2.getByTestId("project-item").filter({ hasText: projectName });
	await expect(projectRowB).toBeVisible();
	await page2.getByTestId("project-expand").first().click();
	await expect(page2.getByTestId("workspace-item")).toHaveCount(1);

	// Tab A: remove the project (kebab → Remove → confirm).
	await projectRowA.hover();
	await projectRowA.getByTestId("project-menu").click();
	await page.getByTestId("project-remove").click();
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await page.getByTestId("confirm-remove-project").click();
	await expect(projectRowA).toHaveCount(0);
	await expect(page.getByTestId("workspace-item")).toHaveCount(0);

	// Tab B converges on `project.removed` (+ workspace.removed for children): no ghost project row.
	await expect(projectRowB).toHaveCount(0);
	await expect(page2.getByTestId("workspace-item")).toHaveCount(0);
});
