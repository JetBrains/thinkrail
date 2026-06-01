import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults } from "../helpers/appSettings";

/**
 * The draft pickers (model / permission / effort) are rendered entirely from
 * the runtime's `runtimes/capabilities` declaration — no hardcoded lists in
 * the frontend. This asserts every option renders, in caps order, with the
 * runtime default (caps[0]) leading.
 */

test("draft pickers render the runtime's declared capabilities in order", async ({
  page,
  tempProject,
}) => {
  // Seed in-caps defaults explicitly: the AppStore (~/.bonsai/bonsai.db) is
  // shared across e2e tests, so a sibling spec's out-of-caps seed could
  // otherwise leak a stray raw <option> into the model list.
  await seedSessionDefaults(tempProject.path, {
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "auto",
  });

  await openProject(page, tempProject.path);
  await page.locator(newSession.newButton).click();

  // ── Models: declared order, Opus 4.8 (the default) first ──
  const modelSelect = page.locator(newSession.modelSelect);
  await expect(modelSelect).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        modelSelect.evaluate((el: HTMLSelectElement) =>
          Array.from(el.options).map((o) => o.text.trim()),
        ),
      { timeout: 15_000 },
    )
    .toEqual(["Opus 4.8", "Sonnet 4.6", "Haiku 4.5"]);

  // ── Permission modes: the SDK's accepted set, default-first ──
  const permSelect = page.locator(newSession.permissionSelect);
  await expect
    .poll(() =>
      permSelect.evaluate((el: HTMLSelectElement) =>
        Array.from(el.options).map((o) => o.value),
      ),
    )
    .toEqual(["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk", "auto"]);

  // ── Effort levels: the SDK's set with "auto" (= SDK effort=None) leading ──
  const effortPills = page.locator("button.draft-config-effort-pill");
  await expect(effortPills).toHaveText(["auto", "low", "medium", "high", "xhigh", "max"]);

  // Fresh draft uses the cold-start default effort ("auto"), so its pill is active.
  await expect(effortPills.filter({ hasText: /^auto$/ })).toHaveClass(
    /draft-config-effort-pill--active/,
  );
});
