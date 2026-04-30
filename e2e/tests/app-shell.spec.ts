import { test, expect } from "../fixtures";
import { loginAs, openProject } from "../helpers/login";
import { appShell, header, serverInfoDialog, tokenDialog } from "../helpers/selectors";

/**
 * AppShell smoke: theme switcher, Server Info dialog, Token dialog, status bar.
 */

test.describe("AppShell chrome", () => {
  test.beforeEach(async ({ page, admin, tempProject }) => {
    await loginAs(page, admin.token);
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

  test("Token dialog masks the stored token (type=password)", async ({ page, admin }) => {
    // The lock-icon button has different titles depending on token presence;
    // when logged in, it's "Token configured" with the .header-token-active class.
    await page.locator("button.header-token-active").click();
    await expect(page.getByRole("heading", { name: "Authentication Token" })).toBeVisible();

    const input = page.locator(tokenDialog.input);
    await expect(input).toHaveAttribute("type", "password");
    // Sanity: input pre-loaded with the current token (the value is still the
    // real token in the DOM, but visually masked by type=password).
    await expect(input).toHaveValue(admin.token);

    // Cancel — must NOT trigger the page reload that Save/Clear do.
    await page.getByRole(tokenDialog.cancelButton.role, { name: tokenDialog.cancelButton.name }).click();
    await expect(page.getByRole("heading", { name: "Authentication Token" })).toHaveCount(0);
  });
});
