import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults } from "../helpers/appSettings";

/**
 * Out-of-caps config values (after a model retirement or a removed effort
 * level) are preserved through draft creation and surfaced raw — never
 * silently rewritten to the runtime default. Validation runs only at launch.
 */

test("an out-of-caps effort renders with no active pill", async ({
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

  const effortPills = page.locator("button.draft-config-effort-pill");
  await expect(effortPills.first()).toBeVisible({ timeout: 15_000 });

  // "bogus" matches no declared effort level → nothing is highlighted.
  await expect(
    page.locator("button.draft-config-effort-pill.draft-config-effort-pill--active"),
  ).toHaveCount(0);
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

  // The model select keeps the unknown id selected (rendered as a raw option),
  // rather than coercing to the runtime default.
  const modelSelect = page.locator(newSession.modelSelect);
  await expect(modelSelect).toHaveValue("claude-ghost-9", { timeout: 15_000 });
});
