import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedProject } from "../helpers/specs";
import { header } from "../helpers/selectors";

test.describe("UI preferences", () => {
  test("collapsed left panel persists across reload via localStorage", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    await openProject(page, tempProject.path);

    const leftPanelLocator = page.locator(".left-panel");
    await expect(leftPanelLocator).toBeVisible();

    // Empty projects auto-focus the welcome textarea; global shortcuts are
    // ignored while a text input is focused. Click the logo to blur first.
    await page.locator(header.logo).click();
    await page.keyboard.press("Alt+b");
    await expect(leftPanelLocator).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".status-bar")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".left-panel")).toHaveCount(0, { timeout: 30_000 });

    // Restore state so the next test doesn't inherit a collapsed panel.
    await page.locator(header.logo).click();
    await page.keyboard.press("Alt+b");
    await expect(page.locator(".left-panel")).toBeVisible({ timeout: 15_000 });
  });
});
