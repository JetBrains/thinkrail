import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedTicket } from "../helpers/board";
import { buildSpec, seedProject } from "../helpers/specs";
import { boardView, ticketDetail } from "../helpers/selectors";

/**
 * MetaTicketDetail smoke: open a seeded ticket, edit description, link a spec,
 * verify TicketProgressBar reflects ticket status. Sessions are exercised by
 * the session-* specs — here we only assert the sidebar count for a seeded
 * sessionId so we don't need an LLM call.
 */

test.describe("MetaTicketDetail", () => {
  test("renders ticket, edits description, reflects state in progress bar", async ({
    page,
    tempProject,
  }) => {
    // Seed a spec so the linked-specs list shows a real entry.
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

    const ticketId = seedTicket(tempProject.path, {
      title: "Implement widget",
      body: "Initial body.",
      status: "technical-design",
      type: "feature",
      linkedSpecIds: ["example-spec"],
      sessionIds: ["bs_seed1234"],
    });

    await openProject(page, tempProject.path);

    // Tab selection is persisted to localStorage, so previous tests can leave
    // uiStore on either Sessions or Board. Force Board explicitly.
    await page.getByRole("tab", { name: "Board" }).click();

    const card = page.locator(boardView.ticketCard, { hasText: "Implement widget" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    await expect(page.locator(ticketDetail.root)).toBeVisible({ timeout: 15_000 });

    // Sidebar header shows the title.
    await expect(page.locator(ticketDetail.headerTitleInput)).toHaveValue(
      "Implement widget",
    );

    // Linked specs surface as a count in the header (the detail no longer
    // lists them by title here).
    await expect(page.locator(ticketDetail.root)).toContainText("1 spec", {
      timeout: 15_000,
    });

    // Progress section (TicketPhaseList): the current-phase row reflects the
    // ticket status — here "technical-design" → "Technical design".
    await expect(
      page.locator(".ticket-section-title", { hasText: "Progress" }),
    ).toBeVisible();
    await expect(page.locator(".tpl-row--current .tpl-label")).toContainText(
      "Technical design",
    );

    // The board single-click opens a read-only preview; enter the full ticket
    // route to edit (Monaco only mounts there).
    await page.getByRole("button", { name: /Go to ticket/ }).click();
    await expect(page.locator(ticketDetail.root)).toBeVisible({ timeout: 15_000 });

    // Edit the description: the inline ✎ toggles a MarkdownEditor (Monaco),
    // with Save/Cancel in the section header. Drive Monaco via its accessible
    // textarea (its `.view-lines` can be zero-height in this narrow panel).
    await page.locator(".ticket-desc-edit-btn").click();
    const editor = page.getByRole("textbox", { name: "Editor content" });
    await expect(editor).toBeAttached({ timeout: 15_000 });
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    const newBody = `Updated body — ${Date.now()}`;
    await page.keyboard.insertText(newBody);

    await page
      .locator(".ticket-desc-edit-actions button", { hasText: "Save" })
      .click();

    // The ticket file on disk reflects the new body.
    const ticketPath = join(
      tempProject.path,
      ".tr",
      "tickets",
      ticketId,
      "ticket.json",
    );
    await expect
      .poll(
        () => JSON.parse(readFileSync(ticketPath, "utf8")).body as string,
        { timeout: 15_000 },
      )
      .toContain("Updated body");
  });

});
