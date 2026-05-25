import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults } from "../helpers/appSettings";

/**
 * Regression: a new session draft must pick up the user-scoped session
 * defaults stored in the AppStore (model / effort / permission mode /
 * max turns).
 *
 * Defaults live in the user-scoped AppStore record at
 * ``backend/app/core/session_defaults.py`` (key ``session_defaults``).
 * The spec seeds non-default values via the
 * ``appSettings/setSessionDefaults`` RPC *before* the UI opens, then
 * asserts the DraftConfigCard reflects every one.
 *
 * Why each assertion lives where it does:
 *  - model: assert on the *selected option's text*, not its value. The
 *    catalog uses dated ids for some models; matching by label keeps
 *    the assertion stable if the id ever shifts.
 *  - permission mode: option values are literal strings (`"acceptEdits"`
 *    etc.), so `toHaveValue` is unambiguous.
 *  - effort / max turns: pill buttons; the selected one carries the
 *    `--active` modifier on `.draft-config-effort-pill`.
 */

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
    maxTurns: 20,
  });

  await openProject(page, tempProject.path);

  // Spawn a draft via the header "+ New" button.
  await page.locator(newSession.newButton).click();

  // Model dropdown's *selected option* must reflect the seeded model.
  const modelSelect = page.locator(newSession.modelSelect);
  await expect(modelSelect).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        modelSelect.evaluate((el: HTMLSelectElement) =>
          (el.options[el.selectedIndex]?.text ?? "").trim(),
        ),
      { timeout: 15_000 },
    )
    .toBe("Haiku 4.5");

  // Permission mode picker uses literal mode strings as <option> values.
  const permSelect = page.locator(newSession.permissionSelect);
  await expect(permSelect).toHaveValue("acceptEdits", { timeout: 15_000 });

  // Effort pill row — the selected one carries `--active`.
  const lowEffortPill = page.locator(
    "button.draft-config-effort-pill",
    { hasText: /^low$/ },
  );
  await expect(lowEffortPill).toHaveClass(/draft-config-effort-pill--active/, {
    timeout: 15_000,
  });

  // Turns pill row — same component family. 20 is in TURN_OPTIONS so the
  // seeded value lights an existing pill.
  const turnsPill = page.locator(
    "button.draft-config-effort-pill",
    { hasText: /^20$/ },
  );
  await expect(turnsPill).toHaveClass(/draft-config-effort-pill--active/, {
    timeout: 15_000,
  });
});
