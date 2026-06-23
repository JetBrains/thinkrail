import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedDeliverable, seedSession, seedTicket } from "../helpers/board";
import { leftPanel, sessionManager } from "../helpers/selectors";

/**
 * The sidebar Sessions panel must list every session — including finished work
 * that has no live backend runner. The backend reports `active=false` for any
 * done/error/interrupted session, so a panel that only renders active sessions
 * silently hides all completed work (and contradicts the status-bar pill, which
 * counts the full `session/list`). These specs lock in that finished sessions
 * stay reachable from the panel.
 */

/** Open the SessionManager via the left panel's Sessions tab. */
async function openSessionManager(p: Page): Promise<void> {
  await p.locator(leftPanel.sessionsTab).click();
  await expect(p.locator(sessionManager.panel)).toBeVisible({ timeout: 15_000 });
}

test.describe("sidebar Sessions panel", () => {
  test("lists finished standalone sessions, not just active ones", async ({
    page,
    tempProject,
  }) => {
    // A deliverable marks the project "initialized" so the picker opens the
    // workspace (not the onboarding wizard) without seeding an unrelated ticket.
    seedDeliverable(tempProject.path);
    // Two standalone (no-ticket) finished sessions on disk: one completed, one
    // errored. Neither has a live runner, so the backend reports active=false
    // for both — they must still appear as cards in the panel.
    seedSession(tempProject.path, {
      id: "bs_e2edone01",
      name: "Finished work session",
      status: "done",
    });
    seedSession(tempProject.path, {
      id: "bs_e2eerr01",
      name: "Errored work session",
      status: "error",
    });

    await openProject(page, tempProject.path);
    await openSessionManager(page);

    const panel = page.locator(sessionManager.panel);
    await expect(panel.getByText("Finished work session")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("Errored work session")).toBeVisible({ timeout: 15_000 });
    // Exactly the two seeded sessions — no more, no fewer.
    await expect(panel.locator(sessionManager.card)).toHaveCount(2);
  });

  test("surfaces a finished ticket's session as a ticket folder", async ({
    page,
    tempProject,
  }) => {
    const ticketId = "mt_e2edone01";
    seedSession(tempProject.path, {
      id: "bs_e2etdone01",
      name: "Stage: implement",
      status: "done",
      ticketId,
    });
    seedTicket(tempProject.path, {
      id: ticketId,
      title: "Shipped feature",
      type: "feature",
      sessionIds: ["bs_e2etdone01"],
    });

    await openProject(page, tempProject.path);
    await openSessionManager(page);

    const panel = page.locator(sessionManager.panel);
    // The done ticket-attached session groups into a ticket folder (it would be
    // filtered out entirely if the panel only kept active sessions).
    await expect(panel.locator(sessionManager.ticketFolder)).toHaveCount(1);
    // A ticket-attached session is grouped under its folder, never as a loose card.
    await expect(panel.locator(sessionManager.card)).toHaveCount(0);
  });
});
