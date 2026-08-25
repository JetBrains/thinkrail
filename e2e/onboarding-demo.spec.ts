import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

test("the mocked onboarding simulation runs intro → scripted flow, never touching real projects", async ({
	page,
}) => {
	await openAppFresh(page);
	await expect(page.getByTestId("project-item")).toHaveCount(0);

	await page.getByTestId("onboarding-launch").click();
	await expect(page.getByTestId("onboarding-sim")).toBeVisible();
	await expect(page.getByTestId("onboarding-intro")).toContainText("Welcome to ThinkRail");
	await expect(page.getByTestId("onboarding-progress")).toBeAttached();
	await expect(page.getByTestId("onboarding-intro")).toContainText("Before we start");
	await expect(page.getByTestId("onboarding-git")).toContainText("Git is ready");

	const coach = page.getByTestId("onboarding-coach");
	await expect(coach).toContainText("Open a project");
	await expect(coach).not.toContainText("Step");
	await page.getByTestId("sim-open-project").click();

	await expect(coach).toContainText("Choose your project folder");
	await page.getByTestId("sim-folder").click();

	await expect(coach).toContainText("Create a workspace");
	await page.getByTestId("sim-add-workspace").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await expect(coach).toContainText("Create the workspace");
	await page.getByTestId("create-workspace").click();

	await expect(coach).toContainText("Create a second workspace");
	await page.getByTestId("sim-add-workspace").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await expect(coach).toContainText("Create the second workspace");
	await page.getByTestId("create-workspace").click();

	await expect(coach).toContainText("Start the first agent");
	await expect(page.getByTestId("onboarding-insert-prompt")).toHaveCount(0);
	await expect(page.getByTestId("sim-composer")).toHaveValue(
		"Add search functionality to the To Do app.",
	);
	await page.getByTestId("sim-send").click();

	await expect(coach).toContainText("Switch to your second workspace");
	await page.getByTestId("sim-ws-1").click();

	await expect(coach).toContainText("Run a second agent in parallel");
	await expect(page.getByTestId("sim-composer")).toHaveValue("Add a filter for completed tasks.");
	await page.getByTestId("sim-send").click();

	await page.getByTestId("onboarding-finish").click();
	await expect(page.getByTestId("onboarding-sim")).toHaveCount(0);
	await expect(page.getByTestId("project-item")).toHaveCount(0);
});

test("Close demo leaves the demo at any time without touching real state", async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("onboarding-launch").click();

	await expect(page.getByTestId("onboarding-intro")).toBeVisible();
	await page.getByTestId("onboarding-close").click();

	await expect(page.getByTestId("onboarding-sim")).toHaveCount(0);
	await expect(page.getByTestId("project-item")).toHaveCount(0);
});
