import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedTicket } from "../helpers/board";
import { buildSpec, seedProject } from "../helpers/specs";
import { boardView, ticketDetail } from "../helpers/selectors";

/**
 * MetaTicketDetail smoke (new ticket route). Open a seeded ticket from the
 * board and confirm the detail panel renders its title, linked-spec count,
 * read-only description, and section chrome — then "Go to ticket" enters the
 * full route.
 *
 * The redesigned ticket UI made the body read-only (no inline editor) and
 * replaced the phase/progress bar with a stage-derived lifecycle + StageGraph,
 * so this asserts what the route now exposes rather than driving an edit.
 */

test.describe("MetaTicketDetail", () => {
  test("renders a seeded ticket preview and enters the full route", async ({
    page,
    tempProject,
  }) => {
    // Seed a spec so the linked-specs count shows a real entry.
    seedProject(tempProject.path, [
      {
        relPath: "specs/example-spec.md",
        content: buildSpec({
          id: "example-spec",
          type: "module-design",
          status: "active",
          title: "Example Module",
        }),
      },
    ]);

    seedTicket(tempProject.path, {
      title: "Implement widget",
      body: "Initial body.",
      status: "technical-design",
      type: "feature",
      linkedSpecIds: ["example-spec"],
      sessionIds: ["bs_seed1234"],
    });

    await openProject(page, tempProject.path);

    // Tab selection is persisted to localStorage, so previous tests can leave
    // uiStore on either view. Force Board explicitly.
    await page.getByRole("tab", { name: "Board" }).click();

    const card = page.locator(boardView.ticketCard, { hasText: "Implement widget" });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Board single-click opens the read-only preview (BoardTicketPreview →
    // TicketInfo); the board stays in the center.
    await card.click();
    await expect(page.locator(ticketDetail.root)).toBeVisible({ timeout: 15_000 });

    // Header shows the title and the linked-spec count.
    await expect(page.locator(ticketDetail.headerTitleInput)).toHaveValue(
      "Implement widget",
    );
    await expect(page.locator(ticketDetail.root)).toContainText("1 spec", {
      timeout: 15_000,
    });

    // The seeded body renders read-only in the Description section.
    await expect(page.locator(ticketDetail.root)).toContainText("Initial body.");

    // The detail panel's section chrome renders (Description + Orchestration).
    await expect(
      page.locator(ticketDetail.sectionTitle, { hasText: "Orchestration" }),
    ).toBeVisible();

    // "Go to ticket" enters the full ticket route — the detail still renders
    // (now as the ticket tab's body).
    await page.getByRole("button", { name: /Go to ticket/ }).click();
    await expect(page.locator(ticketDetail.root)).toBeVisible({ timeout: 15_000 });
  });
});
