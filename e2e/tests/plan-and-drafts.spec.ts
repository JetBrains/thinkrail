import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedDrafts, seedTicket } from "../helpers/board";
import { buildSpec, seedProject } from "../helpers/specs";
import { boardView, specDiffs, ticketDetail } from "../helpers/selectors";

/**
 * Plan + spec-drafts smoke. We seed both pieces directly to disk because
 * generating them through the UI would require LLM calls — the goal here is
 * to lock the *UI surface* that views/edits/applies them.
 */

test.describe("Spec drafts (Spec Diffs panel)", () => {
  test("lists drafts, applies one, discards another, surfaces patches", async ({
    page,
    tempProject,
  }) => {
    // Seed the project with a spec that exists, so an "update" draft has a
    // real file to diff against.
    const originalSpec = buildSpec({
      id: "alpha",
      type: "module-design",
      status: "active",
      title: "Alpha Module",
      body: "# Alpha\n\nOriginal body.\n",
    });
    seedProject(tempProject.path, [
      { relPath: "specs/alpha.md", content: originalSpec },
    ]);

    const ticketId = seedTicket(tempProject.path, {
      title: "Spec draft holder",
      body: "Has drafts.",
      status: "specified",
      linkedSpecIds: ["alpha"],
    });

    // Two drafts: one update to the existing alpha spec, one create for a
    // brand-new beta spec.
    seedDrafts(tempProject.path, ticketId, [
      {
        realPath: "specs/alpha.md",
        operation: "update",
        registryId: "alpha",
        registryType: "module-design",
        registryTitle: "Alpha Module",
        content: buildSpec({
          id: "alpha",
          type: "module-design",
          status: "active",
          title: "Alpha Module",
          body: "# Alpha\n\nUpdated body via draft.\n",
        }),
      },
      {
        realPath: "specs/beta.md",
        operation: "create",
        registryId: "beta",
        registryType: "module-design",
        registryTitle: "Beta Module",
        content: buildSpec({
          id: "beta",
          type: "module-design",
          status: "active",
          title: "Beta Module",
          body: "# Beta\n\nNew spec from draft.\n",
        }),
      },
    ]);

    await openProject(page, tempProject.path);

    await page
      .locator(boardView.ticketCard, { hasText: "Spec draft holder" })
      .click();
    await expect(page.locator(ticketDetail.root)).toBeVisible({ timeout: 15_000 });

    // Open Spec Diffs panel from the sidebar.
    await page
      .locator(ticketDetail.sectionHeader, { hasText: /Spec Diffs/ })
      .click();
    await expect(page.locator(ticketDetail.rightTitle)).toHaveText("Spec Diffs");

    // Pending tab should be active by default and list two entries.
    const entries = page.locator(specDiffs.entry);
    await expect(entries).toHaveCount(2, { timeout: 15_000 });
    await expect(entries.filter({ hasText: "Alpha Module" })).toHaveCount(1);
    await expect(entries.filter({ hasText: "Beta Module" })).toHaveCount(1);

    // Click the Alpha entry → diff editor renders with the path label.
    await entries.filter({ hasText: "Alpha Module" }).click();
    await expect(page.locator(specDiffs.editor)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(specDiffs.editor)).toContainText(
      "specs/alpha.md",
    );

    // Discard the Beta draft via its "✗" button.
    const betaEntry = entries.filter({ hasText: "Beta Module" });
    await betaEntry.locator(specDiffs.discardBtn).click();
    await expect(page.locator(specDiffs.entry)).toHaveCount(1, { timeout: 15_000 });

    // Apply All — the remaining alpha update should land on disk and a patch
    // record should appear in the History tab.
    await page.locator(specDiffs.approveAll).click();

    // Original spec file now contains the new body.
    const alphaPath = join(tempProject.path, "specs", "alpha.md");
    await expect
      .poll(() => readFileSync(alphaPath, "utf8"), { timeout: 15_000 })
      .toContain("Updated body via draft.");

    // History tab now shows the applied patch.
    await page.locator(specDiffs.tab, { hasText: "History" }).click();
    await expect(
      page.locator(`${specDiffs.tabActive}`, { hasText: "History" }),
    ).toBeVisible();
    await expect(page.locator(specDiffs.entry)).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(
      page.locator(specDiffs.entry).first(),
    ).toContainText("Alpha Module");

    // Revert the patch — the alpha file's content should return to the seed.
    await page
      .locator(specDiffs.entry)
      .first()
      .locator(specDiffs.discardBtn)
      .click();

    await expect
      .poll(() => readFileSync(alphaPath, "utf8"), { timeout: 15_000 })
      .toContain("Original body.");
  });
});
