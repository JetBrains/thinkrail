import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { appShell } from "../helpers/selectors";

/**
 * AppShell smoke: status bar visible once the project is open.
 */

test.describe("AppShell chrome", () => {
  test.beforeEach(async ({ page, tempProject }) => {
    await openProject(page, tempProject.path);
  });

  test("status bar is visible after the project loads", async ({ page }) => {
    await expect(page.locator(appShell.statusBar)).toBeVisible();
    await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible();
  });
});
