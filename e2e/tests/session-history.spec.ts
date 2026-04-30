import { test, expect } from "../fixtures";
import { loginAs, openProject } from "../helpers/login";
import {
  endSession,
  startSessionWithModel,
  waitForIdle,
  waitForSessionActivity,
} from "../helpers/session";
import {
  progressTab,
  sessionManager,
  statusBar,
} from "../helpers/selectors";

/**
 * SessionHistory + SessionManager smoke: a completed session shows up in
 * the Progress tab's history list AND in the SessionManager modal, and
 * "Continue" reopens it with prior messages.
 */

const HAIKU = { label: "Haiku 4.5" } as const;

test.describe.configure({ mode: "serial" });

test.describe("Session history", () => {
  test("completed session appears in history and can be continued", async ({
    page,
    admin,
    tempProject,
  }) => {
    test.slow();
    await loginAs(page, admin.token);
    await openProject(page, tempProject.path);

    // Run + end one session to populate history.
    await startSessionWithModel(page, HAIKU, "Reply with just 'hi'.");
    await waitForSessionActivity(page);
    await waitForIdle(page);
    await endSession(page);

    // Close the session tab — closeSession archives done/error sessions into
    // the in-memory `archivedSessions` slice, which SessionHistory reads.
    await page
      .locator(".session-tab:has(.session-tab-dot) .session-tab-close")
      .first()
      .click();

    // Switch to the Progress tab in the left panel — SessionHistory lives there.
    await page
      .getByRole(progressTab.tabButton.role, { name: progressTab.tabButton.name })
      .click();
    await expect(page.locator(progressTab.historyItem).first()).toBeVisible({
      timeout: 30_000,
    });

    // Open the SessionManager via the status-bar "N sessions" button.
    await page.locator(statusBar.sessionsButton).click();
    await expect(page.locator(sessionManager.panel)).toBeVisible({
      timeout: 30_000,
    });

    // The completed session card surfaces a Continue button.
    const continueBtn = page.locator(sessionManager.continueBtn).first();
    await expect(continueBtn).toBeVisible({ timeout: 30_000 });
    await continueBtn.click();

    // After Continue, the SessionPanel takes over and the chat stream renders.
    // Prior assistant messages should be visible (they hydrate from the
    // persisted event log before any new turn starts).
    await expect(page.locator(".chat-stream")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".chat-assistant").first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
