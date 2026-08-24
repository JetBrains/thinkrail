import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openAppFresh, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

test.beforeEach(() => {
	rmSync(join(E2E_DATA_DIR, "demo"), { recursive: true, force: true });
});

test("the left-panel launcher runs the simulated empty-state flow into the live demo", async ({
	page,
}) => {
	await openAppFresh(page);

	await page.getByTestId("onboarding-launch").click();

	const coach = page.getByTestId("onboarding-coach");
	await expect(coach).toContainText("Step 1 of 4");
	await expect(coach).toContainText("Open a project");
	await page.getByTestId("demo-open-project").click();

	await expect(coach).toContainText("Choose your project folder");
	await page.getByTestId("demo-folder-todo").click();

	await expect(page.getByTestId("project-item")).toHaveCount(1);
	await expect(page.getByTestId("welcome-title")).toHaveText("To Do App");
	await expect(coach).toContainText("Step 2 of 4");

	await page.getByTestId("welcome-cta").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await page.getByTestId("create-workspace").click();
	await expect(worktreeRows(page)).toHaveCount(1);

	await expect(coach).toContainText("Step 2 of 4");
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(2);

	await expect(coach).toContainText("Step 3 of 4");

	await page.getByTestId("onboarding-exit").click();
	await expect(page.getByTestId("onboarding-coach")).toHaveCount(0);
});

test("the empty-state Welcome card starts the demo directly at the live coach", async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("welcome-demo").click();

	await expect(page.getByTestId("project-item")).toHaveCount(1);
	await expect(page.getByTestId("onboarding-coach")).toContainText("Step 2 of 4");

	await page.getByTestId("onboarding-exit").click();
	await expect(page.getByTestId("onboarding-coach")).toHaveCount(0);
});
