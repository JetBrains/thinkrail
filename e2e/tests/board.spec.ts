import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { loginAs, openProject } from "../helpers/login";
import { seedProject } from "../helpers/specs";
import { boardView, createTicketModal } from "../helpers/selectors";

/**
 * BoardView smoke: create a meta-ticket through the UI, move it across kanban
 * columns via the right-click context menu (drag-and-drop is hard to fire
 * reliably with @dnd-kit/react in Playwright, so we exercise the explicit
 * status-change flow instead — same RPC, same persistence).
 */

test.describe("BoardView", () => {
  test("create ticket, move via context menu, persists across reload", async ({
    page,
    admin,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    await loginAs(page, admin.token);
    await openProject(page, tempProject.path);

    await expect(page.locator(boardView.root)).toBeVisible();

    // Open create modal.
    await page.locator(boardView.newButton).first().click();
    await expect(page.locator(createTicketModal.root)).toBeVisible();

    const title = `E2E ticket ${Date.now()}`;
    await page.locator(createTicketModal.titleInput).fill(title);
    await page.locator(createTicketModal.bodyTextarea).fill("Some body content.");
    await page
      .getByRole(createTicketModal.createButton.role, {
        name: createTicketModal.createButton.name,
      })
      .click();

    // Modal closes; the new card appears in the Idea column.
    await expect(page.locator(createTicketModal.root)).toHaveCount(0);
    const card = page.locator(boardView.ticketCard, { hasText: title });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The created card lives in the "Idea" column.
    const ideaColumn = page.locator(boardView.kanbanColumn, { hasText: "Idea" });
    await expect(ideaColumn.locator(boardView.ticketCard, { hasText: title })).toBeVisible();

    // Move via context menu: right-click → "Status" → "described".
    await card.click({ button: "right" });
    await expect(page.locator(boardView.ctxMenu)).toBeVisible();
    await page
      .locator(boardView.ctxMenuItem, { hasText: /^described$/ })
      .first()
      .click();
    await expect(page.locator(boardView.ctxMenu)).toHaveCount(0);

    // The card should be in the Described column now.
    const describedColumn = page.locator(boardView.kanbanColumn, { hasText: "Described" });
    await expect(
      describedColumn.locator(boardView.ticketCard, { hasText: title }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      ideaColumn.locator(boardView.ticketCard, { hasText: title }),
    ).toHaveCount(0);

    // The status change must have hit disk.
    const ticketsDir = join(tempProject.path, ".bonsai", "meta-tickets");
    expect(existsSync(ticketsDir)).toBe(true);
    const files = readdirSync(ticketsDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const ticket = JSON.parse(readFileSync(join(ticketsDir, files[0]), "utf8"));
    expect(ticket.status).toBe("described");
    expect(ticket.title).toBe(title);

    // Reload and confirm the column is preserved.
    await page.reload();
    await expect(page.locator(boardView.root)).toBeVisible({ timeout: 30_000 });
    await expect(
      describedColumn.locator(boardView.ticketCard, { hasText: title }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("create modal closes via Cancel without persisting", async ({
    page,
    admin,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    await loginAs(page, admin.token);
    await openProject(page, tempProject.path);

    await page.locator(boardView.newButton).first().click();
    await expect(page.locator(createTicketModal.root)).toBeVisible();

    await page.locator(createTicketModal.titleInput).fill("Should be cancelled");
    await page
      .locator(createTicketModal.root)
      .getByRole(createTicketModal.cancelButton.role, {
        name: createTicketModal.cancelButton.name,
      })
      .click();

    await expect(page.locator(createTicketModal.root)).toHaveCount(0);
    await expect(
      page.locator(boardView.ticketCard, { hasText: "Should be cancelled" }),
    ).toHaveCount(0);

    // No ticket files were written.
    const ticketsDir = join(tempProject.path, ".bonsai", "meta-tickets");
    if (existsSync(ticketsDir)) {
      const files = readdirSync(ticketsDir).filter((f) => f.endsWith(".json"));
      expect(files.length).toBe(0);
    }
  });
});
