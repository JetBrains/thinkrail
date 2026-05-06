import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { appShell, projectPicker } from "../helpers/selectors";

/**
 * ProjectPicker coverage:
 *  - autocomplete popover shows when typing a partial path and can be dismissed
 *  - opening an existing (already-initialized) project succeeds
 *  - "Recent Projects" list shows previously-opened projects after a reload
 *  - stale entries (deleted directories) are purged from recents on next load
 *  - DELETE with a raw symlink path removes an entry stored as its resolved path
 *  - invalid (non-existent) path surfaces a picker error and offers a "Create folder" affordance
 */

test("autocomplete popover renders for a typed prefix and Escape dismisses it", async ({
  page,
  tempProject,
}) => {
  await page.goto("/");

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
  tempProject,
}) => {
  // Pre-init the project on disk so the picker takes the "valid" branch
  // (no auto-init) and we exercise the plain "open existing" flow.
  mkdirSync(join(tempProject.path, ".bonsai"), { recursive: true });

  await openProject(page, tempProject.path);

  await expect(page.locator(appShell.statusBar)).toBeVisible();
});

test("recent projects list shows a project after it has been opened once", async ({
  page,
  tempProject,
}) => {
  // First visit: open the project (auto-initializes it). This records a
  // recent-project entry in the local AppStore (single-user, no auth).
  mkdirSync(join(tempProject.path, ".bonsai"), { recursive: true });
  await openProject(page, tempProject.path);

  // Bounce back to the picker. Navigating to "/" without a stored last-project
  // re-renders ProjectPicker; a fresh page load triggers the recents fetch.
  await page.evaluate(() => localStorage.removeItem("bonsai-last-project"));
  await page.goto("/");
  await expect(page.locator(projectPicker.pathInput)).toBeVisible();

  // The recents list now shows exactly the project we just opened (this is a
  // fresh tempProject, so no prior history). The recorded path is the
  // resolved form (Path.resolve), which can differ from `tempProject.path`
  // on platforms where the tmp dir is a symlink — match by basename instead.
  const basename = tempProject.path.split("/").pop()!;
  const recents = page.locator(projectPicker.recentItem);
  await expect(recents.first()).toBeVisible({ timeout: 5_000 });
  await expect(recents.filter({ hasText: basename }).first()).toBeVisible();
});

test("deleted project directory is purged from recents on reload", async ({
  page,
  tempProject,
}) => {
  mkdirSync(join(tempProject.path, ".bonsai"), { recursive: true });
  await openProject(page, tempProject.path);

  await page.evaluate(() => localStorage.removeItem("bonsai-last-project"));
  await page.goto("/");
  await expect(page.locator(projectPicker.pathInput)).toBeVisible();

  const basename = tempProject.path.split("/").pop()!;
  await expect(
    page.locator(projectPicker.recentItem).filter({ hasText: basename }),
  ).toBeVisible({ timeout: 5_000 });

  // Delete the project directory — next GET /api/projects/known will purge the stale entry.
  rmSync(tempProject.path, { recursive: true, force: true });

  await page.reload();
  await expect(page.locator(projectPicker.pathInput)).toBeVisible();
  await expect(
    page.locator(projectPicker.recentItem).filter({ hasText: basename }),
  ).toHaveCount(0, { timeout: 5_000 });
});

test("DELETE with a raw symlink path removes an entry stored as its resolved path", async ({
  page,
  tempProject,
}) => {
  // On macOS /tmp is a symlink to /private/var/folders/... The backend resolves
  // paths on POST, so the entry is stored as the canonical /private/... form.
  // The DELETE endpoint must also normalize so that sending the raw form still
  // matches — otherwise the e2e fixture cleanup silently no-ops and stale
  // entries accumulate across test runs.
  mkdirSync(join(tempProject.path, ".bonsai"), { recursive: true });
  await openProject(page, tempProject.path);

  await page.evaluate(() => localStorage.removeItem("bonsai-last-project"));
  await page.goto("/");
  await expect(page.locator(projectPicker.pathInput)).toBeVisible();

  const basename = tempProject.path.split("/").pop()!;
  await expect(
    page.locator(projectPicker.recentItem).filter({ hasText: basename }),
  ).toBeVisible({ timeout: 5_000 });

  // DELETE using the raw (possibly symlinked) path — not the resolved form.
  const del = await page.request.delete(
    `/api/projects/known?path=${encodeURIComponent(tempProject.path)}`,
  );
  expect(del.status()).toBe(200);

  await page.reload();
  await expect(page.locator(projectPicker.pathInput)).toBeVisible();
  await expect(
    page.locator(projectPicker.recentItem).filter({ hasText: basename }),
  ).toHaveCount(0, { timeout: 5_000 });
});

test("non-existent path shows a picker error with a Create-folder affordance", async ({
  page,
}) => {
  // Build a path under a fresh tmp dir whose subfolder definitely does not
  // exist yet. We clean up either branch (created via UI or not).
  const sandbox = mkdtempSync(join(tmpdir(), "bonsai-e2e-missing-"));
  const missing = join(sandbox, "subdir-that-does-not-exist");

  try {
    await page.goto("/");

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
