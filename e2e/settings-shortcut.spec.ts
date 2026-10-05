import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	pressPlatformShortcut,
	visibleTerminal,
	waitTerminalReady,
} from "./fixtures/app";
import { installNativeShortcuts, setNavigatorPlatform } from "./fixtures/nativeShortcuts";

const settingsDialog = (page: Page) => page.getByTestId("settings-dialog");

async function closeSettings(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(settingsDialog(page)).toHaveCount(0);
}

async function expectInertWithMenuOpen(page: Page, trigger: () => Promise<unknown>): Promise<void> {
	const openMenu = page.locator('[role="menu"][data-state="open"]');
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await expect(openMenu).toHaveCount(1);
	await trigger();
	await expect(settingsDialog(page)).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(openMenu).toHaveCount(0);
}

test("browser Cmd+, on macOS opens Settings on the last section, like the gear", async ({
	page,
}) => {
	await setNavigatorPlatform(page, "MacIntel");
	await openAppFresh(page);
	await page.locator("body").click();

	await page.keyboard.press("Meta+Comma");
	await expect(settingsDialog(page)).toBeVisible();
	await expect(page.getByTestId("settings-nav-providers")).toHaveAttribute("data-active", "true");
	await page.getByTestId("settings-nav-templates").click();
	await closeSettings(page);

	await page.keyboard.press("Meta+Comma");
	await expect(page.getByTestId("settings-nav-templates")).toHaveAttribute("data-active", "true");
	await closeSettings(page);

	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-nav-templates")).toHaveAttribute("data-active", "true");
});

test("browser Cmd+, works from the terminal and is inert behind a modal or menu", async ({
	page,
}) => {
	await setNavigatorPlatform(page, "MacIntel");
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await waitTerminalReady(page);
	const terminalInput = visibleTerminal(page).locator(".xterm-helper-textarea");
	await terminalInput.focus();
	await expect(terminalInput).toBeFocused();
	await page.keyboard.press("Meta+Comma");
	await expect(settingsDialog(page)).toBeVisible();
	await closeSettings(page);

	const newWorkspace = page.getByTestId("new-workspace-dialog");
	await page.locator("body").click();
	await pressPlatformShortcut(page, "n");
	await expect(newWorkspace).toBeVisible();
	await page.keyboard.press("Meta+Comma");
	await expect(newWorkspace).toBeVisible();
	await expect(settingsDialog(page)).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(newWorkspace).toHaveCount(0);

	await expectInertWithMenuOpen(page, () => page.keyboard.press("Meta+Comma"));
});

test("neither Ctrl+, nor Meta+, opens Settings in a Linux browser", async ({ page }) => {
	await setNavigatorPlatform(page, "Linux x86_64");
	await openAppFresh(page);
	await page.locator("body").click();
	await page.keyboard.press("Control+Comma");
	await page.keyboard.press("Meta+Comma");
	await expect(page.getByTestId("open-settings")).toBeVisible();
	await expect(settingsDialog(page)).toHaveCount(0);
});

test("with the native bridge only the open-settings command opens Settings, gated by modals and menus", async ({
	page,
}) => {
	await installNativeShortcuts(page, "MacIntel");
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.locator("body").click();

	await page.keyboard.press("Meta+Comma");
	await expect(page.getByTestId("open-settings")).toBeVisible();
	await expect(settingsDialog(page)).toHaveCount(0);

	await page.evaluate(() => window.__e2eShortcuts.command("open-settings"));
	await expect(settingsDialog(page)).toBeVisible();
	await closeSettings(page);

	const newWorkspace = page.getByTestId("new-workspace-dialog");
	await pressPlatformShortcut(page, "n");
	await expect(newWorkspace).toBeVisible();
	await page.evaluate(() => window.__e2eShortcuts.command("open-settings"));
	await expect(newWorkspace).toBeVisible();
	await expect(settingsDialog(page)).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(newWorkspace).toHaveCount(0);

	await expectInertWithMenuOpen(page, () =>
		page.evaluate(() => window.__e2eShortcuts.command("open-settings")),
	);
});
