import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedProject } from "../helpers/specs";
import { fileTree, fileViewer, leftPanel } from "../helpers/selectors";

/**
 * FileTree + FileViewer smoke. Seed a temp project with a couple of non-spec
 * files, switch to the Files tab, see the tree, and click a file to load it
 * into the FileViewer (REST `/api/files/read`).
 *
 * NB: depth-0 directories are auto-expanded by the FileTree's
 * `computeDefaultCollapsed` heuristic, so we don't need to click to expand
 * top-level dirs — clicking would *collapse* them.
 */

test.describe("FileTree + FileViewer", () => {
  test("renders seeded files and previews a non-spec file via REST", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);
    // Seed a small set of regular files (not specs) so we can preview them.
    mkdirSync(join(tempProject.path, "src"), { recursive: true });
    writeFileSync(
      join(tempProject.path, "src", "config.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2),
      "utf8",
    );
    writeFileSync(
      join(tempProject.path, "README.md"),
      "# Fixture project\n\nUsed by file-explorer spec.\n",
      "utf8",
    );

    await openProject(page, tempProject.path);

    // Switch to the Files tab in the left panel.
    await page.locator(leftPanel.filesTab).click();
    await expect(page.locator(fileTree.root)).toBeVisible();

    // Top-level entries should appear: README.md, the src/ directory, and
    // because depth-0 dirs are auto-expanded, src's child config.json too.
    const readmeRow = page.locator(fileTree.row, { hasText: "README.md" });
    const configRow = page.locator(fileTree.row, { hasText: "config.json" });
    await expect(readmeRow).toBeVisible({ timeout: 15_000 });
    await expect(configRow).toBeVisible({ timeout: 15_000 });

    // Double-click pins the file as the active tab, which guarantees the
    // FileViewer renders (single-click only loads a *preview* and the
    // FileViewer is gated on `previewFile` being fully fetched, which is
    // racy under Playwright).
    await configRow.dblclick();
    await expect(page.locator(fileViewer.root)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(fileViewer.path)).toContainText(
      "src/config.json",
    );
    // Monaco renders the JSON file (lines visible).
    await expect(page.locator(fileViewer.monacoViewLines).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("collapse-all hides expanded directories", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);
    mkdirSync(join(tempProject.path, "subdir"), { recursive: true });
    writeFileSync(
      join(tempProject.path, "subdir", "leaf.txt"),
      "leaf",
      "utf8",
    );

    await openProject(page, tempProject.path);

    await page.locator(leftPanel.filesTab).click();
    await expect(page.locator(fileTree.root)).toBeVisible();

    // subdir is auto-expanded (depth-0 dir), so leaf.txt is already visible.
    const leafRow = page.locator(fileTree.row, { hasText: "leaf.txt" });
    await expect(leafRow).toBeVisible({ timeout: 15_000 });

    // Collapse all → leaf.txt is no longer visible.
    await page.locator(fileTree.collapseAllBtn).click();
    await expect(leafRow).toHaveCount(0);
  });
});
