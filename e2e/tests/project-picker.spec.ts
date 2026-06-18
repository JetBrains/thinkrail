import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { appShell } from "../helpers/selectors";

/**
 * ProjectPicker happy path: open an already-initialized project via the
 * recents list.
 */

test("opens an already-initialized project and shows the AppShell", async ({
  page,
  tempProject,
}) => {
  mkdirSync(join(tempProject.path, ".tr"), { recursive: true });

  await openProject(page, tempProject.path);

  await expect(page.locator(appShell.viewSwitcher)).toBeVisible();
});
