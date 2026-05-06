import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { appShell, projectPicker } from "../helpers/selectors";

/**
 * Project init flow: opening a brand-new (unininitialized) directory.
 *
 * The picker auto-initializes any path that exists but lacks `.bonsai/`. After
 * init, the AppShell loads with `isNewProject=true`, which surfaces
 * NewProjectScreen inside SessionPanel until a session is started or files
 * appear. We verify:
 *   - `.bonsai/` is created on disk
 *   - the AppShell mounts (status bar visible)
 *   - NewProjectScreen renders with the goal-entry form
 *
 * We do NOT click "Define Goals" because that path requires a real Anthropic
 * session — the LLM-driven flow is covered by the session-lifecycle specs.
 */

test("opening a fresh temp directory auto-inits the project and shows NewProjectScreen", async ({
  page,
  tempProject,
}) => {
  // Sanity: the temp dir exists but has no .bonsai/ yet.
  expect(existsSync(join(tempProject.path, ".bonsai"))).toBe(false);

  await page.goto("/");

  // Open the not-yet-initialized project. We don't use the openProject helper
  // here because we want to assert the new-project screen specifically — the
  // helper waits on the status bar, which is fine, but we follow up with
  // NewProjectScreen-specific assertions.
  const pathInput = page.locator(projectPicker.pathInput);
  await expect(pathInput).toBeVisible();
  await pathInput.fill(tempProject.path);
  await page.keyboard.press("Escape");
  await page
    .getByRole(projectPicker.openButton.role, { name: projectPicker.openButton.name })
    .click();

  // Status bar = AppShell mounted.
  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible({ timeout: 30_000 });

  // .bonsai/ now exists on disk — the backend's POST /api/project/init created it.
  expect(existsSync(join(tempProject.path, ".bonsai"))).toBe(true);

  // SessionPanel routes to NewProjectScreen for first-time projects.
  await expect(page.locator(".welcome-screen")).toBeVisible();
  await expect(page.getByText("What are your project goals?")).toBeVisible();
  await expect(page.locator('input[placeholder="Project name (required)"]')).toBeVisible();
});

test("NewProjectScreen rejects an empty project name", async ({
  page,
  tempProject,
}) => {
  await page.goto("/");

  const pathInput = page.locator(projectPicker.pathInput);
  await pathInput.fill(tempProject.path);
  await page.keyboard.press("Escape");
  await page
    .getByRole(projectPicker.openButton.role, { name: projectPicker.openButton.name })
    .click();
  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible({ timeout: 30_000 });

  // The "Define Goals" button enables once the prompt is non-empty, but
  // clicking it without a project name surfaces an inline validation error
  // and does not start the session.
  const promptArea = page.locator("textarea.welcome-textarea");
  await expect(promptArea).toBeVisible();
  await promptArea.fill("Build something cool");

  const startBtn = page.getByRole("button", { name: /Define Goals/ });
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  await expect(page.locator(".np-name-error")).toBeVisible();
  await expect(page.locator(".welcome-name-input--error")).toBeVisible();
  // Still on the goal-entry form — no session was started.
  await expect(page.getByText("What are your project goals?")).toBeVisible();
});
