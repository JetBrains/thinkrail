import { test, expect } from "../fixtures";
import { loginAs, openProject } from "../helpers/login";
import { appShell } from "../helpers/selectors";

/**
 * Smoke spec for the shared infrastructure: admin fixture + temp-project fixture
 * + login/openProject helpers + globalSetup. Runs first (filename starts with `_`).
 */
test("login + open temp project + status bar visible", async ({ page, admin, tempProject }) => {
  await loginAs(page, admin.token);
  await openProject(page, tempProject.path);

  await expect(page.locator(appShell.statusBar)).toBeVisible();
  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible();
});
