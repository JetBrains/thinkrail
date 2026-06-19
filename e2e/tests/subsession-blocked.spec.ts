import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { startSessionWithModel, waitForSessionActivity } from "../helpers/session";
import { newSession, sessionPanel } from "../helpers/selectors";

/**
 * Subsession nesting + the parent "active child" tab marker.
 *
 * A subsession is a session with a `parent_id`. The SessionTabBar nests it
 * under its parent with a `↳` prefix and marks the parent tab with `⏸` while
 * it has any non-terminal child — the marker is client-derived (a child whose
 * status isn't done/error, drafts included) and clears once the child ends.
 * (The new UI dropped the older parent-input-blocking; this `⏸` marker is the
 * remaining signal.) This drives the real flow — branch a subsession via
 * `/discuss`, start it, end it — asserting on the status-driven `⏸` marker so
 * it stays stable regardless of agent output.
 */

const PAUSE = "⏸"; // ⏸ — SessionTabBar's "parent has a non-terminal child" marker
const ARROW = "↳"; // ↳ — subsession nesting prefix

const markedParentTabs = (page: Page) =>
  page.locator(".session-tab-name").filter({ hasText: PAUSE });
const subsessionTabs = (page: Page) =>
  page.locator(".session-tab-name").filter({ hasText: ARROW });
// The subsession tab (↳) and the parent tab (its name derives from the parent
// prompt below); used to switch between the two sessions.
const subsessionTab = (page: Page) =>
  page.locator(".session-tab").filter({ hasText: ARROW });
const parentTab = (page: Page) =>
  page.locator(".session-tab").filter({ hasText: /Reply with/i });

test("a non-terminal subsession marks its parent tab until it ends", async ({
  page,
  tempProject,
}) => {
  test.slow(); // involves real agent turns

  await openProject(page, tempProject.path);

  // Parent session. Constrain the agent so it settles to idle without asking a
  // question (a pending question would replace the main input the /discuss
  // command needs). Haiku for speed.
  await startSessionWithModel(
    page,
    { label: "Haiku 4.5" },
    "Reply with the single word: ready. Do not ask questions and do not use any tools.",
  );
  await waitForSessionActivity(page);

  // The /discuss intercept only fires from the enabled main input — wait for idle.
  await expect(page.locator(sessionPanel.statusButton)).toContainText(/idle/i, {
    timeout: 90_000,
  });

  // No child yet → the parent carries no marker.
  await expect(markedParentTabs(page)).toHaveCount(0);

  // Branch a subsession off the parent via the /discuss slash command.
  await page
    .locator(sessionPanel.inputTextarea)
    .fill("/discuss tradeoffs of JWT vs server-side sessions");
  await page.locator(sessionPanel.inputSend).click();

  // The subsession opens as a draft, nested under the parent (↳). A
  // non-terminal child — even a draft — marks the parent tab with ⏸.
  const startBtn = page.getByRole(newSession.startButton.role, {
    name: newSession.startButton.name,
  });
  await expect(startBtn).toBeVisible({ timeout: 15_000 });
  await expect(subsessionTabs(page)).toHaveCount(1);
  await expect(markedParentTabs(page)).toHaveCount(1, { timeout: 15_000 });

  // Start the subsession → its runner goes live; the parent stays marked.
  await startBtn.click();
  await expect(markedParentTabs(page)).toHaveCount(1, { timeout: 45_000 });

  // Interrupt the subsession to idle first (the discuss agent keeps asking its
  // own questions, so ending mid-turn races a fresh question and the end signal
  // never drains). From idle there is no live turn to re-ask.
  await subsessionTab(page).click();
  const stopBtn = page.getByRole("button", { name: /^Stop$/ });
  await expect(stopBtn).toBeVisible({ timeout: 45_000 });
  await stopBtn.click();
  await expect(page.locator(sessionPanel.statusButton)).toContainText(/idle/i, {
    timeout: 45_000,
  });

  // End the subsession from idle → finished → the parent's marker clears.
  await page.locator(sessionPanel.statusButton).click();
  await page
    .locator(sessionPanel.statusDropdownItem)
    .filter({ hasText: /End session/i })
    .click();
  await expect(markedParentTabs(page)).toHaveCount(0, { timeout: 45_000 });

  // The parent tab survives the subsession's lifecycle and stays selectable.
  await parentTab(page).click();
  await expect(parentTab(page)).toHaveCount(1);
});
