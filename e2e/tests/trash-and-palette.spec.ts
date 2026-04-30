import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { loginAs, openProject } from "../helpers/login";
import { seedTrashedPlan } from "../helpers/board";
import { buildSpec, seedProject } from "../helpers/specs";
import { palette, specTree, trashModal } from "../helpers/selectors";

/**
 * CommandPalette + TrashModal smoke. Alt+K opens the palette under Playwright's
 * Chromium (which the app's `isMod` resolves to `e.altKey`); running the
 * "Open Trash" action surfaces seeded trashed items, which can then be
 * restored back to disk. The palette also navigates to a seeded spec, proving
 * its spec-picker mode.
 */

test.describe("CommandPalette + TrashModal", () => {
  test("Alt+K opens palette and 'Open Trash' restores a trashed plan", async ({
    page,
    admin,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);
    const ticketId = "mt_trashed01";
    seedTrashedPlan(tempProject.path, { ticketId });

    await loginAs(page, admin.token);
    await openProject(page, tempProject.path);

    // The app's `isMod` is `e.altKey` on non-Mac (and Playwright's Chromium
    // reports as non-Mac regardless of the host OS — the status bar shows
    // "Alt+K Search"). So trigger the palette with Alt+k.
    await page.keyboard.press("Alt+k");
    await expect(page.locator(palette.container)).toBeVisible();

    // Type "/trash" to filter the actions list to "Open Trash".
    await page.locator(palette.input).fill("/trash");
    const openTrashItem = page.locator(palette.item, { hasText: "Open Trash" });
    await expect(openTrashItem).toBeVisible();
    await openTrashItem.click();

    // Palette closes; TrashModal opens with the seeded trashed plan listed.
    await expect(page.locator(palette.container)).toHaveCount(0);
    await expect(page.locator(trashModal.container)).toBeVisible({
      timeout: 15_000,
    });
    const trashedPlan = page.locator(trashModal.item).first();
    await expect(trashedPlan).toBeVisible({ timeout: 15_000 });
    await expect(trashedPlan).toContainText(ticketId);

    // Restore the plan — file returns to .bonsai/plans/.
    await trashedPlan.locator(trashModal.restoreBtn).click();

    const planPath = join(
      tempProject.path,
      ".bonsai",
      "plans",
      `${ticketId}.md`,
    );
    await expect
      .poll(() => existsSync(planPath), { timeout: 15_000 })
      .toBe(true);

    // After restore, the trash list shows the empty state.
    await expect(page.locator(trashModal.emptyMsg)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Alt+K palette navigates to a seeded spec", async ({
    page,
    admin,
    tempProject,
  }) => {
    seedProject(tempProject.path, [
      {
        relPath: "specs/palette-target.md",
        content: buildSpec({
          id: "palette-target",
          type: "module-design",
          status: "active",
          title: "Palette Target Spec",
          body: "# Palette Target\n\nSeeded for palette navigation.\n",
        }),
      },
    ]);

    await loginAs(page, admin.token);
    await openProject(page, tempProject.path);

    // Wait for the spec to be indexed before opening the palette — the
    // palette's spec list reads from the same store the SpecTree uses.
    await expect(
      page.locator(specTree.row, { hasText: "Palette Target Spec" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Alt+k");
    await expect(page.locator(palette.container)).toBeVisible();

    // Type a substring of the spec title to filter results.
    await page.locator(palette.input).fill("palette");
    const specItem = page
      .locator(palette.item, { hasText: "Palette Target Spec" })
      .first();
    await expect(specItem).toBeVisible({ timeout: 15_000 });
    await specItem.click();

    // Palette closes and the spec is marked selected in the SpecTree — the
    // palette's `selectSpec` only updates `selectedSpecId`; it doesn't load
    // the file preview (that happens via the SpecTree row click). Asserting
    // the selected-row class is enough to prove the action wired through.
    await expect(page.locator(palette.container)).toHaveCount(0);
    await expect(
      page.locator(specTree.selectedRow, { hasText: "Palette Target Spec" }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
