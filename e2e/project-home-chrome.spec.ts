import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	goProjectHome,
	openAppFresh,
	openFixtureProject,
	pressPlatformShortcut,
} from "./fixtures/app";

async function expectProjectsShown(page: Page): Promise<void> {
	await expect(page.getByTestId("welcome-shell-layout")).toHaveAttribute(
		"data-left-collapsed",
		"false",
	);
	await expect(page.getByTestId("tool-rail-projects")).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByTestId("left-layout-rail").getByTestId("rail-selection-indicator"),
	).toHaveCount(1);
	await expect(page.getByTestId("auxiliary-pane-header")).toHaveText("Projects");
	await expect(page.getByTestId("left-nav")).toBeVisible();
}

async function expectProjectsHidden(page: Page): Promise<void> {
	await expect(page.getByTestId("welcome-shell-layout")).toHaveAttribute(
		"data-left-collapsed",
		"true",
	);
	await expect(page.getByTestId("tool-rail-projects")).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.getByTestId("left-layout-rail").getByTestId("rail-selection-indicator"),
	).toHaveCount(0);
	await expect(page.getByTestId("left-nav")).toBeHidden();
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
}

test("the start screen carries the left tool rail and plain Projects pane header", async ({
	page,
}) => {
	await openAppFresh(page);
	await expectProjectsShown(page);
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("right-layout-rail")).toHaveCount(0);
	await expect(page.getByTestId("bottom-tool-rail")).toHaveCount(0);

	const rail = page.getByTestId("left-layout-rail");
	await expect(rail).toHaveAttribute("aria-label", "Left tools");
	await expect(rail).toHaveCSS("width", "40px");
	await expect(page.getByTestId("auxiliary-pane-header")).toHaveCSS("height", "28px");
	const control = page.getByTestId("tool-rail-projects");
	await expect(control).toHaveAccessibleName("Projects");
	const paneId = await control.getAttribute("aria-controls");
	expect(paneId).toBeTruthy();
	await expect(page.locator(`#${paneId}`)).toHaveAttribute("aria-label", "Projects");
	await expect(page.getByTestId("side-group-fold")).toHaveAttribute("aria-controls", paneId ?? "");
});

test("Project Home hides and restores Projects through the rail, Hide, and Mod+B", async ({
	page,
}) => {
	await openFixtureProject(page);
	await expectProjectsShown(page);

	await page.getByTestId("project-name").first().focus();
	await page.getByTestId("side-group-fold").click();
	await expectProjectsHidden(page);
	await expect(page.getByTestId("tool-rail-projects")).toBeFocused();

	await page.keyboard.press("Enter");
	await expectProjectsShown(page);
	await expect(page.getByTestId("project-name").first()).toBeFocused();

	await pressPlatformShortcut(page, "b");
	await expectProjectsHidden(page);
	await expect(page.getByTestId("tool-rail-projects")).toBeFocused();

	await pressPlatformShortcut(page, "b");
	await expectProjectsShown(page);
	await expect(page.getByTestId("project-name").first()).toBeFocused();

	const welcomeAction = page.getByTestId("welcome-action").first();
	await welcomeAction.focus();
	await pressPlatformShortcut(page, "b");
	await expectProjectsHidden(page);
	await expect(welcomeAction).toBeFocused();

	await page.getByTestId("tool-rail-projects").click();
	await expectProjectsShown(page);
	await page.getByTestId("tool-rail-projects").click();
	await expectProjectsHidden(page);
	await expect(page.getByTestId("tool-rail-projects")).toBeFocused();
});

test("entering a workspace and returning to Project Home keeps the same left chrome", async ({
	page,
}) => {
	await openFixtureProject(page);
	const homeRail = await page.getByTestId("left-layout-rail").boundingBox();
	const homeHeader = await page.getByTestId("auxiliary-pane-header").boundingBox();
	if (!homeRail || !homeHeader) throw new Error("Project Home chrome has no bounding box");

	await enterDefaultWorkspace(page);
	const workbenchRail = await page.getByTestId("left-layout-rail").boundingBox();
	const workbenchHeader = await page
		.locator('[data-testid="side-group"][data-tools="projects"]')
		.getByTestId("auxiliary-pane-header")
		.boundingBox();
	if (!workbenchRail || !workbenchHeader) throw new Error("workbench chrome has no bounding box");
	expect(workbenchRail.x).toBeCloseTo(homeRail.x, 0);
	expect(workbenchRail.width).toBeCloseTo(homeRail.width, 0);
	expect(workbenchHeader.y).toBeCloseTo(homeHeader.y, 0);
	expect(workbenchHeader.height).toBeCloseTo(homeHeader.height, 0);

	await goProjectHome(page);
	await expectProjectsShown(page);
	await expect(page.getByTestId("right-layout-rail")).toHaveCount(0);
	await expect(page.getByTestId("bottom-tool-rail")).toHaveCount(0);
});
