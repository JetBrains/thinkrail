import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
	visibleTerminal,
	waitTerminalReady,
} from "./fixtures/app";

const PANES = ["left-stack", "right-stack", "bottom-panel"] as const;
type Pane = (typeof PANES)[number];

async function openDefaultWorkbench(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);
}

async function expectShown(page: Page, shown: readonly Pane[]): Promise<void> {
	for (const pane of PANES) {
		if (shown.includes(pane)) await expect(page.getByTestId(pane)).toBeVisible();
		else await expect(page.getByTestId(pane)).toHaveCount(0);
	}
}

async function hideAllPanels(page: Page): Promise<void> {
	await pressPlatformShortcut(page, "Shift+F12");
}

test("Mod+Shift+F12 hides the shown panes and brings back exactly those", async ({ page }) => {
	await openDefaultWorkbench(page);
	await expectShown(page, PANES);
	await pressPlatformShortcut(page, "j");
	await expectShown(page, ["left-stack", "bottom-panel"]);

	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await hideAllPanels(page);
	await expectShown(page, []);
	await expect(page.locator(".xterm-helper-textarea")).toHaveCount(0);

	await hideAllPanels(page);
	await expectShown(page, ["left-stack", "bottom-panel"]);
});

test("opening a pane by hand clears what the chord remembered", async ({ page }) => {
	await openDefaultWorkbench(page);
	await hideAllPanels(page);
	await expectShown(page, []);

	await revealWorkbenchTool(page, "files");
	await expectShown(page, ["right-stack"]);

	await hideAllPanels(page);
	await expectShown(page, []);
	await hideAllPanels(page);
	await expectShown(page, ["right-stack"]);
});

test("the palette's Hide all panels row shows the chord and runs the same toggle", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	const runRow = async () => {
		await pressPlatformShortcut(page, "k");
		await expect(page.getByTestId("search-input")).toBeFocused();
		await page.getByTestId("search-input").fill(">hide all panels");
		const row = page.locator(
			'[data-testid="search-row"][data-item-id="command:view.toggleAllPanels"]',
		);
		await expect(row).toBeVisible();
		await expect(row.locator("kbd")).toContainText(["F12"]);
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("search-palette")).toBeHidden();
	};

	await runRow();
	await expectShown(page, []);
	await runRow();
	await expectShown(page, PANES);
});
