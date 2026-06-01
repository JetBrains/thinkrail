import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { header, newSession } from "../helpers/selectors";
import { seedSessionDefaults, getSessionDefaults } from "../helpers/appSettings";

/**
 * Settings modal round-trip: open → flip Session Defaults → save → verify the
 * AppStore and a fresh "+ New" draft both reflect the new values.
 *
 * AppStore is shared across every project and every test run, so seed a known
 * starting state first — otherwise assertions can pass on leftover values.
 */

const MODAL = ".settings-modal";
const NAV = `${MODAL} nav[aria-label='Settings sections']`;

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

  for (const label of ["Themes", "Session Defaults", "Server Info", "Settings"]) {
    await expect(page.locator(`${NAV} button`, { hasText: label })).toBeVisible();
  }

  await page.locator(`${NAV} button`, { hasText: "Session Defaults" }).click();
  await expect(
    page.locator(`${MODAL} h3.settings-section__title`),
  ).toHaveText("Session Defaults");

  const modelSelect = page.locator(`${MODAL} select.draft-config-select--model`);
  await expect
    .poll(
      () =>
        modelSelect.evaluate((el: HTMLSelectElement) =>
          (el.options[el.selectedIndex]?.text ?? "").trim(),
        ),
      { timeout: 15_000 },
    )
    .toBe("Opus 4.8");

  const permSelect = page.locator(
    `${MODAL} select.draft-config-select:not(.draft-config-select--model)`,
  );
  await expect(permSelect).toHaveValue("default");
  const saveButton = page.locator(`${MODAL} button.token-dialog-btn-primary`);
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAttribute("title", "No changes to save");

  await modelSelect.selectOption({ label: "Sonnet 4.6" });
  await permSelect.selectOption("acceptEdits");
  await page
    .locator(`${MODAL} button.draft-config-effort-pill`, { hasText: /^low$/ })
    .click();
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

  await page.locator(newSession.newButton).click();
  const draftModel = page.locator(newSession.modelSelect);
  await expect
    .poll(
      () =>
        draftModel.evaluate((el: HTMLSelectElement) =>
          (el.options[el.selectedIndex]?.text ?? "").trim(),
        ),
      { timeout: 15_000 },
    )
    .toBe("Sonnet 4.6");
  await expect(page.locator(newSession.permissionSelect)).toHaveValue(
    "acceptEdits",
    { timeout: 15_000 },
  );
  await expect(
    page.locator("button.draft-config-effort-pill", { hasText: /^low$/ }).first(),
  ).toHaveClass(/draft-config-effort-pill--active/, { timeout: 15_000 });
});
