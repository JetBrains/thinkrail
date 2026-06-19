import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedProject } from "../helpers/specs";
import { appShell, boardView } from "../helpers/selectors";

/**
 * UI preferences persist across a reload via the zustand-persisted uiStore
 * (`thinkrail:ui` in localStorage). The center-view switcher (Board / Workspace)
 * is one such persisted field: switching to Board and reloading must land back
 * on Board rather than the default Workspace view.
 */

test.describe("UI preferences", () => {
  test("center-view selection persists across reload via localStorage", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    await openProject(page, tempProject.path);

    const boardTab = page.getByRole("tab", { name: "Board" });

    // Default view is Workspace; switch to Board and confirm it took.
    await boardTab.click();
    await expect(boardTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(boardView.kanbanColumns)).toBeVisible({ timeout: 15_000 });

    // Reload → the persisted centerView restores Board (not the default).
    await page.reload();
    await expect(page.locator(appShell.viewSwitcher)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("tab", { name: "Board" })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 30_000 },
    );
    await expect(page.locator(boardView.kanbanColumns)).toBeVisible({ timeout: 15_000 });

    // Restore the default so the next test doesn't inherit Board view. (The
    // Workspace tab's own aria-selected is gated on the Specs/Files browser
    // being closed, so assert Board deselects instead — the reliable signal
    // that we've left the board.)
    await page.getByRole("tab", { name: "Workspace" }).click();
    await expect(boardTab).toHaveAttribute("aria-selected", "false");
  });
});
