import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { startSessionWithModel, waitForSessionActivity } from "../helpers/session";
import { newSession, sessionPanel } from "../helpers/selectors";

/**
 * Subsession blocking (session-model unification, Phase 2).
 *
 * A subsession is a session with a `parent_id` that blocks its parent while
 * it is in flight. `blocked` is **backend-derived** (any child status not in
 * {draft, finished}) and served on the session payload; the SessionTabBar
 * shows it as a `⏸` prefix + dimmed parent tab. This drives the real flow —
 * branch a subsession via `/discuss`, start it, end it — and asserts only on
 * the status-driven `⏸` indicator (not on agent output), so it stays stable.
 */

const PAUSE = "⏸"; // ⏸ — SessionTabBar's blocked-parent marker
const ARROW = "↳"; // ↳ — subsession nesting prefix

const blockedTabs = (page: Page) =>
  page.locator(".session-tab-name").filter({ hasText: PAUSE });
const subsessionTabs = (page: Page) =>
  page.locator(".session-tab-name").filter({ hasText: ARROW });
// The subsession tab (↳) and the parent tab (its name derives from the parent
// prompt below); used to switch tabs to inspect each session's input state.
const subsessionTab = (page: Page) =>
  page.locator(".session-tab").filter({ hasText: ARROW });
const parentTab = (page: Page) =>
  page.locator(".session-tab").filter({ hasText: /Reply with/i });

test("a running subsession blocks its parent; ending it unblocks", async ({
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

  // No child yet → parent is not blocked.
  await expect(blockedTabs(page)).toHaveCount(0);

  // Branch a subsession off the parent via the /discuss slash command.
  await page
    .locator(sessionPanel.inputTextarea)
    .fill("/discuss tradeoffs of JWT vs server-side sessions");
  await page.locator(sessionPanel.inputSend).click();

  // The subsession opens as a draft, nested under the parent (↳), and a draft
  // child does NOT block the parent yet.
  const startBtn = page.getByRole(newSession.startButton.role, {
    name: newSession.startButton.name,
  });
  await expect(startBtn).toBeVisible({ timeout: 15_000 });
  await expect(subsessionTabs(page)).toHaveCount(1);
  await expect(blockedTabs(page)).toHaveCount(0);

  // Start the subsession → its runner goes live → the parent becomes blocked.
  await startBtn.click();
  await expect(blockedTabs(page)).toHaveCount(1, { timeout: 45_000 });

  // A blocked parent refuses input: its textarea is disabled and shows the
  // paused hint (enforced both in the UI and the backend).
  await parentTab(page).click();
  const parentInput = page.locator(sessionPanel.inputTextarea);
  await expect(parentInput).toBeDisabled();
  await expect(parentInput).toHaveAttribute("placeholder", /Paused/i);

  // Back to the subsession. Interrupt it to idle first (the discuss agent keeps
  // asking its own questions, so ending mid-turn races a fresh question and the
  // end signal never drains). From idle there is no live turn to re-ask.
  await subsessionTab(page).click();
  const stopBtn = page.getByRole("button", { name: /^Stop$/ });
  await expect(stopBtn).toBeVisible({ timeout: 45_000 });
  await stopBtn.click();
  await expect(page.locator(sessionPanel.statusButton)).toContainText(/idle/i, {
    timeout: 45_000,
  });

  // End the subsession from idle → finished → parent unblocks.
  await page.locator(sessionPanel.statusButton).click();
  await page
    .locator(sessionPanel.statusDropdownItem)
    .filter({ hasText: /End session/i })
    .click();
  await expect(blockedTabs(page)).toHaveCount(0, { timeout: 45_000 });

  // The parent is usable again — input re-enabled.
  await parentTab(page).click();
  await expect(page.locator(sessionPanel.inputTextarea)).toBeEnabled();
});
