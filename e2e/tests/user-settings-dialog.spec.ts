import { test, expect, type Page } from "../fixtures";
import { openProject } from "../helpers/project";
import { header, newSession } from "../helpers/selectors";
import { seedSessionDefaults, getSessionDefaults } from "../helpers/appSettings";
import { selectedLabel } from "../helpers/draftConfig";

/**
 * Settings modal round-trip: open → flip Session Defaults → save → verify the
 * AppStore and a fresh "+ New" draft both reflect the new values.
 *
 * AppStore is shared across every project and every test run, so seed a known
 * starting state first — otherwise assertions can pass on leftover values.
 */

const MODAL = ".settings-modal";
const NAV = `${MODAL} nav[aria-label='Settings sections']`;

// Session Defaults pickers are <Dropdown>s in a `.user-settings-row` keyed by
// its <label> (Model / Permission mode / Effort). The trigger shows the active
// option's label; for perms/effort the SDK value doubles as that label.
const sdTrigger = (rowLabel: string) =>
  `${MODAL} .user-settings-row:has(label:text-is("${rowLabel}")) .dd-trigger`;
const sdLabel = (page: Page, rowLabel: string) =>
  page.locator(`${sdTrigger(rowLabel)} .dd-trigger-label`);
async function pickSetting(page: Page, rowLabel: string, optLabel: string): Promise<void> {
  await page.locator(sdTrigger(rowLabel)).click();
  await page
    .locator(`${MODAL} .dd-menu[role=listbox] .dd-item`, { hasText: optLabel })
    .first()
    .click();
}

test("settings modal Session Defaults tab saves new defaults and they flow into new sessions", async ({
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

  for (const label of ["Session Defaults", "Privacy", "Server Info", "Settings"]) {
    await expect(page.locator(`${NAV} button`, { hasText: label })).toBeVisible();
  }

  await page.locator(`${NAV} button`, { hasText: "Session Defaults" }).click();
  await expect(
    page.locator(`${MODAL} h3.settings-section__title`),
  ).toHaveText("Session Defaults");

  // Seeded defaults are reflected.
  await expect(sdLabel(page, "Model")).toHaveText("Opus 4.8", { timeout: 15_000 });
  await expect(sdLabel(page, "Permission mode")).toHaveText("default");

  const saveButton = page.locator(`${MODAL} button.np-form-btn-primary`);
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAttribute("title", "No changes to save");

  // Flip all three.
  await pickSetting(page, "Model", "Sonnet 4.6");
  await pickSetting(page, "Permission mode", "Accept edits");
  await pickSetting(page, "Effort", "low");
  await expect(saveButton).toBeEnabled();
  await expect(saveButton).toHaveAttribute("title", "Save settings");

  await saveButton.click();
  await expect(page.locator(`${MODAL} .settings-section__saved`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(saveButton).toBeDisabled();

  await expect
    .poll(() => getSessionDefaults(tempProject.path), { timeout: 15_000 })
    .toMatchObject({
      model: "claude-sonnet-4-6",
      permissionMode: "acceptEdits",
      effort: "low",
    });

  // Close via backdrop click: Save moved focus to a now-disabled button, so
  // the modal's Escape handler (gated on focus inside modal content) won't fire.
  await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(page.locator(MODAL)).toBeHidden({ timeout: 15_000 });

  // A fresh draft inherits the new defaults.
  await page.locator(newSession.newButton).click();
  await expect(selectedLabel(page, "model")).toHaveText("Sonnet 4.6", { timeout: 15_000 });
  await expect(selectedLabel(page, "perms")).toHaveText("Accept edits", { timeout: 15_000 });
  await expect(selectedLabel(page, "effort")).toHaveText("low", { timeout: 15_000 });
});
