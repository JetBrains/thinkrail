import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
});
