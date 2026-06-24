import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { openProject } from "../helpers/project";
import { seedDeliverable } from "../helpers/board";
import { newSession } from "../helpers/selectors";
import { seedSessionDefaults } from "../helpers/appSettings";
import { optionLabels, selectedLabel, pickOption } from "../helpers/draftConfig";

/**
 * Effort levels and the 1M-context flag are scoped to the selected model (#62):
 * Haiku accepts no effort level and no 1M window; Sonnet has every effort
 * except xhigh; Opus has the full set. Switching the draft's model also clamps
 * an unsupported effort back to "auto". Driven entirely by the runtime's
 * `runtimes/capabilities` declaration — no live session needed.
 */

const oneMFlag = (page: Page) =>
  page.locator('label.runtime-flag', { hasText: "1M context window" });

test("draft effort levels and the 1M flag follow the selected model", async ({
  page,
  tempProject,
}) => {
  // Seed a high effort so switching to a model without it must clamp.
  await seedSessionDefaults(tempProject.path, {
    model: "claude-opus-4-8",
    permissionMode: "default",
    effort: "xhigh",
  });
  // An initialized project (a `.tr` deliverable) opens straight into the
  // sessions workspace; a bare temp dir would land on the onboarding wizard
  // (no new-session button). See helpers/project.ts.
  seedDeliverable(tempProject.path);

  await openProject(page, tempProject.path);
  await page.locator(newSession.newButton).click();

  // Opus 4.8 — full effort set + 1M flag available.
  await expect(selectedLabel(page, "model")).toHaveText("Opus 4.8", { timeout: 15_000 });
  expect(await optionLabels(page, "effort")).toEqual([
    "auto", "low", "medium", "high", "xhigh", "max",
  ]);
  await expect(oneMFlag(page)).toHaveCount(1);
  await expect(selectedLabel(page, "effort")).toHaveText("xhigh");

  // Haiku 4.5 — no effort levels beyond "auto", 1M flag hidden, effort clamped.
  await pickOption(page, "model", "Haiku 4.5");
  await expect(selectedLabel(page, "model")).toHaveText("Haiku 4.5", { timeout: 15_000 });
  await expect(selectedLabel(page, "effort")).toHaveText("auto"); // xhigh clamped away
  expect(await optionLabels(page, "effort")).toEqual(["auto"]);
  await expect(oneMFlag(page)).toHaveCount(0);

  // Sonnet 4.6 — full effort set minus xhigh, 1M flag back.
  await pickOption(page, "model", "Sonnet 4.6");
  await expect(selectedLabel(page, "model")).toHaveText("Sonnet 4.6", { timeout: 15_000 });
  expect(await optionLabels(page, "effort")).toEqual([
    "auto", "low", "medium", "high", "max",
  ]);
  await expect(oneMFlag(page)).toHaveCount(1);
});
