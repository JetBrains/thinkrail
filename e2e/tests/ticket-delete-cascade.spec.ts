import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedSession, seedTicket } from "../helpers/board";
import { boardView } from "../helpers/selectors";

/**
 * Deleting a ticket must take its sessions with it. The ticket owns an
 * orchestrator session plus any attached stage sessions; leaving those behind
 * leaves a ghost ticket folder in the Sessions panel and orphaned files on
 * disk. The board delete is the only entry point, so we drive it from the UI
 * and assert the session files are gone.
 */

/** A second browser context (own localStorage + WS connection) on the same project. */
async function openSecondClient(
  browser: Browser,
  projectPath: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "X-ThinkRail-E2E": "1" } });
  const page = await ctx.newPage();
  await openProject(page, projectPath);
  return { page, close: () => ctx.close() };
}

test.describe("ticket deletion cascade", () => {
  test("deleting a ticket trashes its orchestrator and attached sessions", async ({
    page,
    tempProject,
  }) => {
    const ticketId = "mt_e2ecascade01";
    const orchSid = "bs_e2eorch01";
    const stepSid = "bs_e2estep01";

    seedSession(tempProject.path, {
      id: orchSid,
      name: "Orchestrate: Cascade ticket",
      ticketId,
    });
    seedSession(tempProject.path, {
      id: stepSid,
      name: "Stage: design",
      ticketId,
    });

    seedTicket(tempProject.path, {
      id: ticketId,
      title: "Cascade ticket",
      type: "feature",
      sessionIds: [orchSid, stepSid],
      orchestratorSessionId: orchSid,
    });

    // An artifact in the ticket folder makes it non-empty, so deletion must
    // remove the whole folder — not just `ticket.json`.
    const ticketDir = join(tempProject.path, ".tr", "tickets", ticketId);
    writeFileSync(join(ticketDir, "product-design.md"), "# design\n", "utf8");

    const orchPath = join(tempProject.path, ".tr", "sessions", `${orchSid}.json`);
    const stepPath = join(tempProject.path, ".tr", "sessions", `${stepSid}.json`);
    expect(existsSync(orchPath)).toBe(true);
    expect(existsSync(stepPath)).toBe(true);

    await openProject(page, tempProject.path);

    // Tab selection is persisted to localStorage — force Board explicitly.
    await page.getByRole("tab", { name: "Board" }).click();

    const card = page.locator(boardView.ticketCard, { hasText: "Cascade ticket" });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The board's delete path goes through a window.confirm — auto-accept it.
    page.on("dialog", (d) => d.accept());

    await card.click({ button: "right" });
    await page
      .locator(boardView.ctxMenuItem, { hasText: /^Delete$/ })
      .click();

    // The card disappears from the board…
    await expect(card).toHaveCount(0, { timeout: 15_000 });

    // …the cascade removes both session files from disk…
    await expect
      .poll(() => existsSync(orchPath), { timeout: 15_000 })
      .toBe(false);
    await expect
      .poll(() => existsSync(stepPath), { timeout: 15_000 })
      .toBe(false);

    // …and the ticket folder (artifacts included) is gone too.
    await expect
      .poll(() => existsSync(ticketDir), { timeout: 15_000 })
      .toBe(false);
  });

  test("a second client drops the ticket when another client deletes it", async ({
    page,
    browser,
    tempProject,
  }) => {
    const ticketId = "mt_e2emc01";
    const orchSid = "bs_e2emcorch";
    const stepSid = "bs_e2emcstep";

    seedSession(tempProject.path, { id: orchSid, name: "Orchestrate: MC ticket", ticketId });
    seedSession(tempProject.path, { id: stepSid, name: "Stage: design", ticketId });
    seedTicket(tempProject.path, {
      id: ticketId,
      title: "Multi-client ticket",
      type: "feature",
      sessionIds: [orchSid, stepSid],
      orchestratorSessionId: orchSid,
    });

    const orchPath = join(tempProject.path, ".tr", "sessions", `${orchSid}.json`);
    const stepPath = join(tempProject.path, ".tr", "sessions", `${stepSid}.json`);

    // Client A — the deleter.
    await openProject(page, tempProject.path);
    await page.getByRole("tab", { name: "Board" }).click();
    const cardA = page.locator(boardView.ticketCard, { hasText: "Multi-client ticket" });
    await expect(cardA).toBeVisible({ timeout: 15_000 });

    // Client B — a separate context watching the same board.
    const clientB = await openSecondClient(browser, tempProject.path);
    try {
      await clientB.page.getByRole("tab", { name: "Board" }).click();
      const cardB = clientB.page.locator(boardView.ticketCard, { hasText: "Multi-client ticket" });
      await expect(cardB).toBeVisible({ timeout: 15_000 });

      // Delete from A — the board delete goes through a window.confirm.
      page.on("dialog", (d) => d.accept());
      await cardA.click({ button: "right" });
      await page.locator(boardView.ctxMenuItem, { hasText: /^Delete$/ }).click();

      // A removes it locally…
      await expect(cardA).toHaveCount(0, { timeout: 15_000 });
      // …and B drops it too, driven only by the board/didDelete broadcast — the
      // point of the fix. Without that broadcast B never hears about the delete
      // and keeps a ghost card (and the ticket's sessions). handleDidDelete also
      // runs removeSessionsForTicket on B (unit-covered), so the ticket's
      // sessions leave B's Sessions panel along with the card.
      await expect(cardB).toHaveCount(0, { timeout: 15_000 });

      // The cascade still runs through the cross-client path: session files gone.
      await expect.poll(() => existsSync(orchPath), { timeout: 15_000 }).toBe(false);
      await expect.poll(() => existsSync(stepPath), { timeout: 15_000 }).toBe(false);
    } finally {
      await clientB.close();
    }
  });
});
