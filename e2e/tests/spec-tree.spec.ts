import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { buildSpec, seedProject } from "../helpers/specs";
import { fileViewer, leftPanel, specTree } from "../helpers/selectors";

/**
 * SpecTree smoke: when the project has spec files, the tree lists them and
 * clicking a row loads the FileViewer (markdown preview) for that spec.
 *
 * The workspace's left panel defaults to the Sessions tab, so each test
 * switches to the Specs tab to surface the SpecTree.
 */

test.describe("SpecTree", () => {
  test("renders seeded specs and previews one on click", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, [
      {
        relPath: "specs/architecture.md",
        content: buildSpec({
          id: "architecture",
          type: "architecture-design",
          status: "active",
          title: "System Architecture",
          body: "# System Architecture\n\nThe system has these parts.\n",
        }),
      },
      {
        relPath: "specs/storage-module.md",
        content: buildSpec({
          id: "storage-module",
          type: "module-design",
          status: "active",
          title: "Storage Module",
          parent: "architecture",
          body: "# Storage Module\n\nDescribes the storage layer.\n",
        }),
      },
    ]);

    await openProject(page, tempProject.path);
    await page.locator(leftPanel.specsTab).click();

    // Tree lists the seeded specs (poll — the index rebuilds asynchronously
    // after the project is opened).
    const archRow = page.locator(specTree.row, { hasText: "System Architecture" });
    const storageRow = page.locator(specTree.row, { hasText: "Storage Module" });
    await expect(archRow).toBeVisible({ timeout: 30_000 });
    await expect(storageRow).toBeVisible({ timeout: 30_000 });

    // Click a spec row → FileViewer takes over the center pane.
    await storageRow.click();

    await expect(page.locator(fileViewer.root)).toBeVisible();
    await expect(page.locator(fileViewer.path)).toContainText("specs/storage-module.md");
    // Markdown preview is the default mode for .md files; assert the rendered
    // heading appears (asserts both the FileViewer wired correctly AND that
    // the file content was loaded over REST).
    await expect(
      page.locator(`${fileViewer.markdownPreview} h1`, { hasText: "Storage Module" }),
    ).toBeVisible();

    // Selected-row class is applied (visual cue that the row is "active").
    await expect(page.locator(specTree.selectedRow)).toContainText("Storage Module");
  });

  test("empty project shows the empty-state placeholder", async ({
    page,
    tempProject,
  }) => {
    // Seed a `.tr/` so the picker accepts it as a valid project, but
    // no spec files yet.
    seedProject(tempProject.path, []);

    await openProject(page, tempProject.path);
    await page.locator(leftPanel.specsTab).click();

    await expect(page.locator(specTree.empty)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(specTree.empty)).toContainText(/No specifications/);
  });
});
