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
	await expect(page.getByTestId("onboarding-intro")).toContainText(
		"ThinkRail works with Git projects",
	);
	await expect(page.getByTestId("onboarding-progress")).toBeAttached();

	const coach = page.getByTestId("onboarding-coach");
	const start = page.getByTestId("onboarding-start");

	await expect(start).toBeDisabled();
	await expect(page.getByTestId("onboarding-git")).toContainText("is Ready");
	await expect(start).toBeEnabled();
	await expect(coach).toHaveCount(0);
	await start.click();

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

	await expect(page.getByTestId("onboarding-final")).toBeVisible();
	await expect(page.getByTestId("onboarding-final")).toContainText("That's the workflow.");
	await expect(page.getByTestId("onboarding-final")).toContainText(
		"Now try it with your own project.",
	);
	await expect(page.getByTestId("onboarding-docs")).toHaveCount(0);
	const finish = page.getByTestId("onboarding-finish");
	await expect(finish).toHaveText("Start working on your own project");
	await finish.click();

	await expect(page.getByTestId("onboarding-sim")).toHaveCount(0);
	await expect(page.getByTestId("project-item")).toHaveCount(0);
});

test("the intro reveals sequentially, gates the CTA on Git readiness, and needs an explicit click", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("onboarding-launch").click();

	const intro = page.getByTestId("onboarding-intro");
	await expect(intro).toBeVisible();
	await expect(intro).not.toContainText("Before we start");
	await expect(intro).toContainText("ThinkRail works with Git projects");
	await expect(intro).toContainText("Let's make sure your computer is ready.");

	const start = page.getByTestId("onboarding-start");
	await expect(start).toHaveAttribute("data-revealed", "false");
	await expect(start).toHaveAttribute("data-revealed", "true");

	const git = page.getByTestId("onboarding-git");
	await expect(git).toHaveAttribute("data-ready", "false");
	await expect(start).toBeDisabled();
	await expect(git).toHaveAttribute("data-ready", "true");
	await expect(git).toContainText("is Ready");
	await expect(start).toBeEnabled();

	await expect(page.getByTestId("onboarding-coach")).toHaveCount(0);
	await start.click();
	await expect(intro).toHaveCount(0);
	await expect(page.getByTestId("onboarding-coach")).toContainText("Open a project");
});

test("the final screen shares the intro layout and reveals sequentially", async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("onboarding-launch").click();
	await page.getByTestId("onboarding-start").click();

	await page.getByTestId("sim-open-project").click();
	await page.getByTestId("sim-folder").click();
	await page.getByTestId("sim-add-workspace").click();
	await page.getByTestId("create-workspace").click();
	await page.getByTestId("sim-add-workspace").click();
	await page.getByTestId("create-workspace").click();
	await page.getByTestId("sim-question-option").first().click();
	await page.getByTestId("sim-ws-0").click();

	await expect(page.getByTestId("onboarding-final")).toBeVisible();
	await expect(page.getByTestId("onboarding-progress")).toBeAttached();
	await expect(page.getByTestId("onboarding-close")).toBeVisible();

	const finish = page.getByTestId("onboarding-finish");
	await expect(finish).toHaveAttribute("data-revealed", "false");
	await expect(finish).toHaveAttribute("data-revealed", "true");
});

test("Close demo leaves the demo at any time without touching real state", async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("onboarding-launch").click();

	await expect(page.getByTestId("onboarding-intro")).toBeVisible();
	await page.getByTestId("onboarding-close").click();

	await expect(page.getByTestId("onboarding-sim")).toHaveCount(0);
	await expect(page.getByTestId("project-item")).toHaveCount(0);
});
