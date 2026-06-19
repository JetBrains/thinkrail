import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { appShell } from "../helpers/selectors";

/**
 * AppShell smoke: the workspace chrome is up once the project is open.
 */

test.describe("AppShell chrome", () => {
  test.beforeEach(async ({ page, tempProject }) => {
    await openProject(page, tempProject.path);
  });

  test("workspace chrome is visible after the project loads", async ({ page }) => {
    await expect(page.locator(appShell.viewSwitcher)).toBeVisible();
  });
});
