import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { header, newSession } from "../helpers/selectors";
import { seedSessionDefaults, getSessionDefaults, type SessionDefaults } from "../helpers/appSettings";
import { acquireAppStoreLock, releaseAppStoreLock } from "../helpers/appStoreLock";

/**
 * Runtime-declared flags render as toggles in Session Defaults and persist to
 * the AppStore. The Claude runtime declares one boolean flag (`context1m`,
 * default on); flipping it off must round-trip through `appSettings`.
 *
 * AppStore is shared across tests, so seed a known starting state (no flags →
 * the toggle reflects the runtime default).
 */

const MODAL = ".settings-modal";
const NAV = `${MODAL} nav[aria-label='Settings sections']`;

let _savedDefaults: SessionDefaults;

test.beforeEach(async ({ tempProject }) => {
  await acquireAppStoreLock();
  _savedDefaults = await getSessionDefaults(tempProject.path);
});

test.afterEach(async ({ tempProject }) => {
  await seedSessionDefaults(tempProject.path, _savedDefaults);
  releaseAppStoreLock();
});

test("the runtime's 1M-context flag renders in settings and persists when toggled", async ({
  page,
  tempProject,
}) => {
  await seedSessionDefaults(tempProject.path, {
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "auto",
  });

  await openProject(page, tempProject.path);

  await page.locator(header.settingsButton).click();
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 15_000 });
  await page.locator(`${NAV} button`, { hasText: "Session Defaults" }).click();

  // The flag is runtime-declared (context1m) and defaults on, so its checkbox
  // is present and checked even though the seeded defaults carry no flags.
  const flag = page.locator(`${MODAL} input#flag-context1m`);
  await expect(flag).toBeVisible({ timeout: 15_000 });
  await expect(flag).toBeChecked();

  await flag.uncheck();

  const saveButton = page.locator(`${MODAL} button.np-form-btn-primary`);
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.locator(`${MODAL} .settings-section__saved`)).toBeVisible({
    timeout: 15_000,
  });

  await expect
    .poll(() => getSessionDefaults(tempProject.path), { timeout: 15_000 })
    .toMatchObject({ flags: { context1m: false } });
});

test("the same flag renders on the session-start draft and is editable", async ({
  page,
  tempProject,
}) => {
  // No flags seeded → the draft inherits the runtime default (on).
  await seedSessionDefaults(tempProject.path, {
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "auto",
  });

  await openProject(page, tempProject.path);
  await page.locator(newSession.newButton).click();

  // The runtime-declared flag renders in the draft config card, defaulted on.
  const flag = page.locator("input#draft-flag-context1m");
  await expect(flag).toBeVisible({ timeout: 15_000 });
  await expect(flag).toBeChecked();

  // Editable per-draft. The checkbox is store-controlled through the same
  // debounced updateDraft path as the model/effort pickers, so click and wait
  // for the round-trip to settle rather than asserting a synchronous flip.
  await flag.click();
  await expect(flag).not.toBeChecked({ timeout: 15_000 });
});
