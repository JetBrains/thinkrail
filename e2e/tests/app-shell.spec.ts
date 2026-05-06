import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { appShell, header, serverInfoDialog } from "../helpers/selectors";

/**
 * AppShell smoke: theme switcher, Server Info dialog, status bar.
 */

test.describe("AppShell chrome", () => {
  test.beforeEach(async ({ page, tempProject }) => {
    await openProject(page, tempProject.path);
  });

  test("status bar is visible after the project loads", async ({ page }) => {
    await expect(page.locator(appShell.statusBar)).toBeVisible();
    await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible();
  });

  test("theme switcher applies data-theme attribute and clears it for system", async ({ page }) => {
    const html = page.locator("html");

    // Open dropdown.
    await page.locator(header.themeButton).click();
    // Click "Light"
    await page.locator(header.themeOption).filter({ hasText: "Light" }).first().click();
    await expect(html).toHaveAttribute("data-theme", "light");

    // Open dropdown again, click Darcula (dark)
    await page.locator(header.themeButton).click();
    await page.locator(header.themeOption).filter({ hasText: "Darcula" }).first().click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    // Open dropdown again, click System → data-theme is removed.
    await page.locator(header.themeButton).click();
    await page.locator(header.themeOption).filter({ hasText: "System" }).first().click();
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
  });

  test("Server Info dialog shows the hostname", async ({ page }) => {
    await page.locator(header.serverInfoButton).click();
    await expect(page.getByRole("heading", { name: "Server Info" })).toBeVisible();
    await expect(page.getByText(serverInfoDialog.hostnameLabel)).toBeVisible();
    // Close it
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Server Info" })).toHaveCount(0);
  });
});
