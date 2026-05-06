import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { appShell } from "../helpers/selectors";

/**
 * Smoke spec for the shared infrastructure: temp-project fixture +
 * openProject helper + globalSetup. Runs first (filename starts with `_`).
 */
test("open temp project + status bar visible", async ({ page, tempProject }) => {
  await openProject(page, tempProject.path);

  await expect(page.locator(appShell.statusBar)).toBeVisible();
  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible();
});
