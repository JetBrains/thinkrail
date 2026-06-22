import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults, getSessionDefaults, type SessionDefaults } from "../helpers/appSettings";
import { selectedLabel } from "../helpers/draftConfig";
import { acquireAppStoreLock, releaseAppStoreLock } from "../helpers/appStoreLock";

/**
 * Out-of-caps config values (after a model retirement or a removed effort
 * level) are preserved through draft creation and surfaced raw — never
 * silently rewritten to the runtime default. Validation runs only at launch.
 * The picker prepends the unknown value as a raw selected option, so its
 * dropdown trigger shows the value verbatim.
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

test("an out-of-caps effort is preserved and shown raw", async ({
  page,
  tempProject,
}) => {
  await seedSessionDefaults(tempProject.path, {
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "bogus",
  });

  await openProject(page, tempProject.path);
  await page.locator(newSession.newButton).click();

  // "bogus" matches no declared effort level → kept as a raw selected option.
  await expect(selectedLabel(page, "effort")).toHaveText("bogus", { timeout: 15_000 });
});

test("an out-of-caps model is preserved and shown as a raw option", async ({
  page,
  tempProject,
}) => {
  await seedSessionDefaults(tempProject.path, {
    model: "claude-ghost-9",
    permissionMode: "default",
    effort: "auto",
  });

  await openProject(page, tempProject.path);
  await page.locator(newSession.newButton).click();

  // The model picker keeps the unknown id selected (rendered as a raw option),
  // rather than coercing to the runtime default.
  await expect(selectedLabel(page, "model")).toHaveText("claude-ghost-9", { timeout: 15_000 });
});
