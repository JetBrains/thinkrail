import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedDeliverable } from "../helpers/board";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults } from "../helpers/appSettings";
import { optionLabels, selectedLabel } from "../helpers/draftConfig";

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
  // Seed in-caps defaults explicitly: the AppStore (~/.tr/tr.db) is
  // shared across e2e tests, so a sibling spec's out-of-caps seed could
  // otherwise leak a stray raw <option> into the model list.
  await seedSessionDefaults(tempProject.path, {
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "auto",
  });
  // Initialized project → opens straight into the sessions workspace (a bare
  // temp dir lands on the onboarding wizard, which has no new-session button).
  seedDeliverable(tempProject.path);

  await openProject(page, tempProject.path);
  await page.locator(newSession.newButton).click();

  // ── Models: declared catalog order (Fable 5 is hidden from the picker). ──
  await expect(selectedLabel(page, "model")).toBeVisible({ timeout: 15_000 });
  expect(await optionLabels(page, "model")).toEqual(["Opus 4.8", "Sonnet 4.6", "Haiku 4.5"]);

  // ── Permission modes: friendly labels, default-first, with dontAsk hidden
  //    from the interactive picker (headless-only; see ClaudeRuntime). ──
  expect(await optionLabels(page, "perms")).toEqual([
    "Ask first", "Accept edits", "Plan only", "Yolo", "Autopilot",
  ]);

  // ── Effort levels: the SDK's set with "auto" (= SDK effort=None) leading ──
  expect(await optionLabels(page, "effort")).toEqual([
    "auto", "low", "medium", "high", "xhigh", "max",
  ]);

  // Fresh draft uses the cold-start default effort ("auto").
  await expect(selectedLabel(page, "effort")).toHaveText("auto");
});
