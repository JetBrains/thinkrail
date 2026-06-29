import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults, getSessionDefaults, type SessionDefaults } from "../helpers/appSettings";
import { selectedLabel } from "../helpers/draftConfig";
import { acquireAppStoreLock, releaseAppStoreLock } from "../helpers/appStoreLock";

/**
 * Regression: a new session draft must pick up the user-scoped session
 * defaults stored in the AppStore (model / effort / permission mode).
 *
 * Defaults live in the user-scoped AppStore record at
 * ``backend/app/core/session_defaults.py`` (key ``session_defaults``).
 * The spec seeds non-default values via the
 * ``appSettings/setSessionDefaults`` RPC *before* the UI opens, then
 * asserts the DraftConfigCard's model / perms / effort dropdowns reflect
 * them. Each dropdown's trigger shows the active option's label; for perms
 * and effort the SDK value doubles as that label.
 */

let _savedDefaults: SessionDefaults;

test.beforeEach(async ({ tempProject }) => {
  await acquireAppStoreLock();
  _savedDefaults = await getSessionDefaults(tempProject.path);
});

test.afterEach(async ({ tempProject }) => {
  await seedSessionDefaults(tempProject.path, _savedDefaults);
  releaseAppStoreLock();
});

test("new-session draft reflects user-scoped session defaults", async ({
  page,
  tempProject,
}) => {
  // Seed before opening the project so the very first WS connect already
  // has the customized values stored. The seeded model id must match a
  // catalog entry in ``backend/app/agent/runtime/claude/models.json``.
  await seedSessionDefaults(tempProject.path, {
    model: "claude-haiku-4-5-20251001",
    permissionMode: "acceptEdits",
    effort: "low",
  });

  await openProject(page, tempProject.path);

  // Spawn a draft via the header "+ New" button.
  await page.locator(newSession.newButton).click();

  // Each dropdown's active label reflects the seeded default. The model
  // catalog uses a dated id but a friendly label ("Haiku 4.5").
  await expect(selectedLabel(page, "model")).toHaveText("Haiku 4.5", { timeout: 15_000 });
  await expect(selectedLabel(page, "perms")).toHaveText("Accept edits", { timeout: 15_000 });
  await expect(selectedLabel(page, "effort")).toHaveText("low", { timeout: 15_000 });
});
