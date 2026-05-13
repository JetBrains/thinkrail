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
      status: "described",
      type: "feature",
      linkedSpecIds: ["example-spec"],
      sessionIds: ["bs_seed1234"],
    });

    await openProject(page, tempProject.path);

    // BoardView renders first; click the seeded card to open the detail view.
    const card = page.locator(boardView.ticketCard, { hasText: "Implement widget" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    await expect(page.locator(ticketDetail.root)).toBeVisible({ timeout: 15_000 });

    // Sidebar header shows the title.
    await expect(page.locator(ticketDetail.headerTitleInput)).toHaveValue(
      "Implement widget",
    );

    // Linked specs list shows the seeded spec by title.
    const linkedItems = page.locator(ticketDetail.linkedItem);
    await expect(linkedItems.filter({ hasText: "Example Module" })).toBeVisible({
      timeout: 15_000,
    });

    // Sessions section shows one entry. The seeded id has no live or archived
    // state, so TicketInfo falls back to the first 8 chars of the id as the
    // displayed name (TicketInfo.tsx ~L332). For "bs_seed1234" that's
    // "bs_seed1".
    const sessionsHeader = page
      .locator(ticketDetail.sectionHeader)
      .filter({ hasText: "Sessions" });
    await expect(sessionsHeader).toBeVisible();
    const seededSessionItem = page
      .locator(ticketDetail.linkedItem)
      .filter({ hasText: "bs_seed1" });
    await expect(seededSessionItem).toBeVisible();

    // Progress bar: current state is "described" → primary action is "Specify with AI".
    await expect(page.locator(ticketDetail.progressLabelCurrent)).toContainText(
      /Described/,
    );
    await expect(page.locator(ticketDetail.progressPrimary)).toContainText(
      /Specify with AI/,
    );

    // Edit description body via the MarkdownEditor.
    // Description panel is auto-selected when the ticket has no plan.
    // Click into Edit tab; type new content; Save.
    await page
      .locator(ticketDetail.rightArea)
      .getByRole("button", { name: /^Edit$/ })
      .first()
      .click();

    const monacoLines = page.locator(
      `${ticketDetail.rightArea} .monaco-editor .view-lines`,
    );
    await expect(monacoLines.first()).toBeVisible({ timeout: 15_000 });
    await monacoLines.first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    const newBody = `Updated body — ${Date.now()}`;
    await page.keyboard.insertText(newBody);

    const saveBtn = page
      .locator(ticketDetail.rightArea)
      .locator(ticketDetail.saveButtonPrimary);
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // The ticket file on disk reflects the new body.
    const ticketPath = join(
      tempProject.path,
      ".bonsai",
      "meta-tickets",
      `${ticketId}.json`,
    );
    await expect
      .poll(
        () => JSON.parse(readFileSync(ticketPath, "utf8")).body as string,
        { timeout: 15_000 },
      )
      .toContain("Updated body");
  });

});
