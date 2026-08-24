import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openAppFresh, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

test.beforeEach(() => {
	rmSync(join(E2E_DATA_DIR, "demo"), { recursive: true, force: true });
});

test("enter the demo, the coach guides creating two workspaces, then reset replays it", async ({
	page,
}) => {
	await openAppFresh(page);

	const demoCard = page.getByTestId("welcome-demo");
	await expect(demoCard).toBeVisible();
	await expect(page.getByTestId("welcome-cta")).toContainText("Open project");
	await demoCard.click();

	await expect(page.getByTestId("project-item")).toHaveCount(1);
	await expect(page.getByTestId("welcome-title")).toHaveText("To Do App");
	await expect(page.getByTestId("welcome-cta")).toContainText("Start building");

	const coach = page.getByTestId("onboarding-coach");
	await expect(coach).toContainText("Step 1 of 3");
	await page.getByTestId("welcome-cta").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await page.getByTestId("create-workspace").click();
	await expect(worktreeRows(page)).toHaveCount(1);

	await expect(coach).toContainText("Step 1 of 3");
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(2);

	await expect(coach).toContainText("Step 2 of 3");

	await page.getByTestId("project-item").first().getByTestId("project-name").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await page.getByTestId("welcome-reset-demo").click();

	await expect(page.getByTestId("project-item")).toHaveCount(0);
	await expect(page.getByTestId("welcome-demo")).toBeVisible();
	await expect(page.getByTestId("onboarding-coach")).toHaveCount(0);
});

test("skipping the tour hides the coach but keeps the demo project", async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("welcome-demo").click();

	const coach = page.getByTestId("onboarding-coach");
	await expect(coach).toContainText("Step 1 of 3");
	await page.getByTestId("onboarding-skip").click();

	await expect(page.getByTestId("onboarding-coach")).toHaveCount(0);
	await expect(page.getByTestId("project-item")).toHaveCount(1);

	await page.getByTestId("project-item").first().getByTestId("project-name").click();
	await page.getByTestId("welcome-reset-demo").click();
	await expect(page.getByTestId("project-item")).toHaveCount(0);
});
