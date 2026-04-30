import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, expect } from "../fixtures";
import { loginAs, openProject } from "../helpers/login";
import { appShell, projectPicker } from "../helpers/selectors";

/**
 * ProjectPicker coverage:
 *  - autocomplete popover shows when typing a partial path and can be dismissed
 *  - opening an existing (already-initialized) project succeeds
 *  - "Recent Projects" list shows previously-opened projects after a reload
 *  - invalid (non-existent) path surfaces a picker error and offers a "Create folder" affordance
 */

test("autocomplete popover renders for a typed prefix and Escape dismisses it", async ({
  page,
  admin,
  tempProject,
}) => {
  await loginAs(page, admin.token);

  const pathInput = page.locator(projectPicker.pathInput);
  await expect(pathInput).toBeVisible();

  // Type the parent directory of tempProject as a prefix. The picker should
  // fetch directory children via /api/fs/list-dirs and render a popover.
  const parent = dirname(tempProject.path);
  const trailing = parent.endsWith("/") ? parent : `${parent}/`;
  await pathInput.fill(trailing);

  const suggestions = page.locator(projectPicker.suggestionList);
  // The fetch is debounced ~200ms; give it some headroom.
  await expect(suggestions).toBeVisible({ timeout: 5_000 });

  // Escape should hide the popover but keep the input value.
  await pathInput.press("Escape");
  await expect(suggestions).toHaveCount(0);
  await expect(pathInput).toHaveValue(trailing);
});

test("opens an already-initialized project and shows the AppShell", async ({
  page,
  admin,
  tempProject,
}) => {
  // Pre-init the project on disk so the picker takes the "valid" branch
  // (no auto-init) and we exercise the plain "open existing" flow.
  mkdirSync(join(tempProject.path, ".bonsai"), { recursive: true });

  await loginAs(page, admin.token);
  await openProject(page, tempProject.path);

  await expect(page.locator(appShell.statusBar)).toBeVisible();
});

test("recent projects list shows a project after it has been opened once", async ({
  page,
  admin,
  tempProject,
}) => {
  // First visit: open the project (auto-initializes it). This records a
  // recent-project entry on the backend for `admin`.
  mkdirSync(join(tempProject.path, ".bonsai"), { recursive: true });
  await loginAs(page, admin.token);
  await openProject(page, tempProject.path);

  // Bounce back to the picker. Navigating to "/" without a stored last-project
  // re-renders ProjectPicker; a fresh page load triggers the recents fetch.
  await page.evaluate(() => localStorage.removeItem("bonsai-last-project"));
  await page.goto("/");
  await expect(page.locator(projectPicker.pathInput)).toBeVisible();

  // The freshly-created admin has no prior history, so the recents list now
  // shows exactly the project we just opened. The recorded path is the
  // resolved form (Path.resolve), which can differ from `tempProject.path`
  // on platforms where the tmp dir is a symlink — match by basename instead.
  const basename = tempProject.path.split("/").pop()!;
  const recents = page.locator(projectPicker.recentItem);
  await expect(recents.first()).toBeVisible({ timeout: 5_000 });
  await expect(recents.filter({ hasText: basename }).first()).toBeVisible();
});

test("non-existent path shows a picker error with a Create-folder affordance", async ({
  page,
  admin,
}) => {
  // Build a path under a fresh tmp dir whose subfolder definitely does not
  // exist yet. We clean up either branch (created via UI or not).
  const sandbox = mkdtempSync(join(tmpdir(), "bonsai-e2e-missing-"));
  const missing = join(sandbox, "subdir-that-does-not-exist");

  try {
    await loginAs(page, admin.token);

    const pathInput = page.locator(projectPicker.pathInput);
    await pathInput.fill(missing);
    // The autocomplete popover may render based on the parent dir; dismiss it
    // so the Open Project button is clickable.
    await page.keyboard.press("Escape");

    await page
      .getByRole(projectPicker.openButton.role, { name: projectPicker.openButton.name })
      .click();

    const error = page.locator(projectPicker.errorMessage);
    await expect(error).toBeVisible();
    await expect(error).toContainText(/Directory does not exist/i);
    // The "Create folder" recovery button is part of the error block.
    await expect(error.getByRole("button", { name: "Create folder" })).toBeVisible();
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
