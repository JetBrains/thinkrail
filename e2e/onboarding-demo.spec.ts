import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

const TASK_1 = "Implement a search feature in my To Do app.";
const TASK_2 = "Add filtering by tags so I can quickly show tasks with a specific tag.";

test("the mocked demo runs intro → parallel-agents payoff, never touching real projects", async ({
	page,
}) => {
	await openAppFresh(page);
	await expect(page.getByTestId("project-item")).toHaveCount(0);

	await page.getByTestId("onboarding-launch").click();
	await expect(page.getByTestId("onboarding-sim")).toBeVisible();
	await expect(page.getByTestId("onboarding-intro")).toContainText("Welcome to ThinkRail");
	await expect(page.getByTestId("onboarding-git")).toContainText("Git is ready");
	await expect(page.getByTestId("onboarding-progress")).toBeAttached();

	const coach = page.getByTestId("onboarding-coach");
	await expect(coach).toContainText("Open a project");
	await page.getByTestId("sim-open-project").click();

	await expect(coach).toContainText("Choose your project folder");
	await page.getByTestId("sim-folder").click();

	await expect(coach).toContainText("Create a workspace");
	await page.getByTestId("sim-add-workspace").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await expect(page.getByTestId("ws-prompt")).toHaveValue(TASK_1);
	await page.getByTestId("create-workspace").click();

	await expect(coach).toContainText("Now start a second task");
	await page.getByTestId("sim-add-workspace").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await expect(page.getByTestId("ws-prompt")).toHaveValue(TASK_2);
	await page.getByTestId("create-workspace").click();

	const question = page.getByTestId("onboarding-question");
	await expect(question).toBeVisible();
	await expect(coach).toContainText("Give the agent feedback");
	await page.getByTestId("sim-question-option").first().click();

	await expect(coach).toContainText("Your agents work in parallel");
	await page.getByTestId("sim-ws-0").click();

	await expect(page.getByTestId("onboarding-finish")).toBeVisible();
	await expect(page.getByTestId("onboarding-docs")).toHaveAttribute("href", "https://thinkrail.ai");
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
