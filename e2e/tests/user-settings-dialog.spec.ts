import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults, getSessionDefaults } from "../helpers/appSettings";

/**
 * Exercise the new User Settings dialog end-to-end.
 *
 * The dialog persists user-scoped session defaults to the AppStore
 * (`~/.bonsai/bonsai.db`) and a new "+ New" draft should immediately
 * reflect them. The AppStore is shared across every project and
 * every test run, so the spec:
 *   1. seeds a known starting state via RPC (so the test isn't at the
 *      mercy of whatever the previous run left behind),
 *   2. opens the dialog and flips every knob to a different value,
 *   3. saves, then asserts both the backend (`getSessionDefaults`) and
 *      a freshly-opened draft picker reflect the change.
 */

const USER_SETTINGS_BTN = ".header-user-settings-btn";
const DIALOG = ".user-settings-dialog";

test("user settings dialog saves new defaults and they flow into new sessions", async ({
  page,
  tempProject,
}) => {
  // 1) Known starting state — opposite of what we'll save below so the
  //    assertions don't accidentally pass on leftover AppStore values.
  await seedSessionDefaults(tempProject.path, {
    model: "claude-opus-4-7",
    permissionMode: "default",
    effort: null,
    maxTurns: 50,
  });

  await openProject(page, tempProject.path);

  // 2) Open the dialog.
  await page.locator(USER_SETTINGS_BTN).click();
  await expect(page.locator(DIALOG)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`${DIALOG} h3`)).toHaveText("User Settings");

  // 3) Starting state visible on each control.
  const modelSelect = page.locator(`${DIALOG} select.draft-config-select--model`);
  await expect
    .poll(
      () =>
        modelSelect.evaluate((el: HTMLSelectElement) =>
          (el.options[el.selectedIndex]?.text ?? "").trim(),
        ),
      { timeout: 15_000 },
    )
    .toBe("Opus 4.7");

  const permSelect = page.locator(
    `${DIALOG} select.draft-config-select:not(.draft-config-select--model)`,
  );
  await expect(permSelect).toHaveValue("default");
  const saveButton = page.locator(`${DIALOG} button.token-dialog-btn-primary`);
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAttribute("title", "No changes to save");

  // 4) Flip every knob. Pick targets that are visibly different from the
  //    seeded starting state.
  await modelSelect.selectOption({ label: "Haiku 4.5" });
  await permSelect.selectOption("acceptEdits");
  await page.locator(`${DIALOG} button.draft-config-effort-pill`, { hasText: /^low$/ }).click();
  await page.locator(`${DIALOG} button.draft-config-effort-pill`, { hasText: /^20$/ }).click();
  await expect(saveButton).toBeEnabled();
  await expect(saveButton).toHaveAttribute("title", "Save settings");

  // 5) Save → dialog closes.
  await saveButton.click();
  await expect(page.locator(DIALOG)).toBeHidden({ timeout: 15_000 });

  // 6) Backend AppStore actually persisted the new values (round-trip
  //    through the RPC, not just optimistic store state).
  await expect
    .poll(() => getSessionDefaults(tempProject.path), { timeout: 15_000 })
    .toMatchObject({
      model: "claude-haiku-4-5",
      permissionMode: "acceptEdits",
      effort: "low",
      maxTurns: 20,
    });

  // 7) A fresh "+ New" draft uses the saved defaults — proves
  //    `buildDefaultSessionConfig` sees the same record the dialog wrote.
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
    .toBe("Haiku 4.5");
  await expect(page.locator(newSession.permissionSelect)).toHaveValue(
    "acceptEdits",
    { timeout: 15_000 },
  );
  await expect(
    page.locator("button.draft-config-effort-pill", { hasText: /^low$/ }).first(),
  ).toHaveClass(/draft-config-effort-pill--active/, { timeout: 15_000 });
});
