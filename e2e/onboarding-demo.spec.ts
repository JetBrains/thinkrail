import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

test("the launcher runs the fully mocked onboarding simulation, never touching real projects", async ({
	page,
}) => {
	await openAppFresh(page);
	await expect(page.getByTestId("project-item")).toHaveCount(0);

	await page.getByTestId("onboarding-launch").click();
	await expect(page.getByTestId("onboarding-sim")).toBeVisible();
	const coach = page.getByTestId("onboarding-coach");

	await expect(coach).toContainText("Step 1 of 4");
	await expect(coach).toContainText("Open a project");
	await page.getByTestId("sim-open-project").click();

	await expect(coach).toContainText("Choose your project folder");
	await page.getByTestId("sim-folder").click();

	await expect(coach).toContainText("Step 2 of 4");
	await page.getByTestId("sim-add-workspace").click();
	await expect(coach).toContainText("Step 2 of 4");
	await page.getByTestId("sim-add-workspace").click();

	await expect(coach).toContainText("Step 3 of 4");
	await page.getByTestId("onboarding-insert-prompt").click();
	await expect(page.getByTestId("sim-composer")).toHaveValue(
		"Add search functionality to the To Do app.",
	);
	await page.getByTestId("sim-send").click();

	await expect(coach).toContainText("Step 4 of 4");
	await expect(coach).toContainText("Switch to your second workspace");
	await page.getByTestId("sim-ws-1").click();

	await expect(coach).toContainText("Run a second agent in parallel");
	await page.getByTestId("onboarding-insert-prompt").click();
	await expect(page.getByTestId("sim-composer")).toHaveValue("Add a filter for completed tasks.");
	await page.getByTestId("sim-send").click();

	await expect(page.getByTestId("onboarding-finish")).toBeVisible();
	await page.getByTestId("onboarding-finish").click();
	await expect(page.getByTestId("onboarding-sim")).toHaveCount(0);

	await expect(page.getByTestId("project-item")).toHaveCount(0);
});

test("the empty-state Welcome card also opens the mocked simulation", async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("welcome-demo").click();

	await expect(page.getByTestId("onboarding-sim")).toBeVisible();
	await expect(page.getByTestId("onboarding-coach")).toContainText("Step 1 of 4");
	await expect(page.getByTestId("project-item")).toHaveCount(0);
});
