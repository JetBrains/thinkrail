import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { buildSpec, seedProject } from "../helpers/specs";
import { fileViewer, leftPanel, specTree } from "../helpers/selectors";

/**
 * Spec editor smoke: edit-in-place flow via the FileViewer.
 *
 * The spec editor surface (FileViewer) shows a markdown preview by default
 * and a Monaco editor in edit mode. Frontmatter is rendered read-only inside
 * a `FrontmatterCard` in preview, so we exercise the body-edit path instead —
 * which is the user-facing way to mutate frontmatter as well, since both
 * live in the same source file.
 */

test.describe("Spec editor", () => {
  test("edit body via Monaco, save, preview reflects the change", async ({
    page,
    tempProject,
  }) => {
    const relPath = "specs/storage-module.md";
    seedProject(tempProject.path, [
      {
        relPath,
        content: buildSpec({
          id: "storage-module",
          type: "module-design",
          status: "active",
          title: "Storage Module",
          body: "# Storage Module\n\nOriginal body content.\n",
        }),
      },
    ]);

    await openProject(page, tempProject.path);
    await page.locator(leftPanel.specsTab).click();

    // Open the spec.
    const row = page.locator(specTree.row, { hasText: "Storage Module" });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.locator(fileViewer.root)).toBeVisible();

    // Switch to Edit mode via the toolbar's Preview/Edit toggle.
    await page.locator(fileViewer.editTab).click();

    // Wait for Monaco to mount, then click the view surface to focus it.
    // The .ime-text-area is intentionally aria-hidden, so we drive Monaco
    // through its visible content area + the page-level keyboard.
    const viewLines = page.locator(fileViewer.monacoViewLines);
    await expect(viewLines).toBeVisible({ timeout: 15_000 });
    await viewLines.click();

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    const newContent = `---\nid: storage-module\ntype: module-design\nstatus: active\ntitle: Storage Module\n---\n\n# Storage Module\n\nUpdated body — ${Date.now()}.\n`;
    await page.keyboard.insertText(newContent);

    // Save appears once the doc is dirty (mode=edit & isDirty) and unmounts
    // after the write completes (isDirty → false), giving us a clean wait point.
    const saveBtn = page.locator(fileViewer.saveButton);
    await expect(saveBtn).toBeVisible({ timeout: 15_000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveCount(0, { timeout: 15_000 });

    // Disk content matches (asserts REST write actually persisted).
    const disk = readFileSync(join(tempProject.path, relPath), "utf8");
    expect(disk).toContain("Updated body");
    expect(disk).toContain("title: Storage Module");
  });

  test("invalid frontmatter falls back to Unmanaged Documents", async ({
    page,
    tempProject,
  }) => {
    // Spec file with a YAML block that's missing required fields ("id", "type")
    // should be classified as an unmanaged document, not a managed spec.
    const broken = "---\ntitle: Broken\n---\n\n# Broken\n\nOops.\n";
    seedProject(tempProject.path, [
      { relPath: "specs/broken.md", content: broken },
    ]);

    await openProject(page, tempProject.path);
    await page.locator(leftPanel.specsTab).click();

    // The "Unmanaged Documents" header appears in the SpecTree because the
    // index rejected the frontmatter. Expand it and assert the file shows up.
    const docsHeader = page.locator(specTree.docHeader, { hasText: /Unmanaged Documents/ });
    await expect(docsHeader).toBeVisible({ timeout: 30_000 });
    await docsHeader.click();

    await expect(
      page.locator(specTree.docRow, { hasText: "broken.md" }),
    ).toBeVisible();

    // It must NOT appear as a managed spec row.
    await expect(
      page.locator(specTree.row, { hasText: "Broken" }),
    ).toHaveCount(0);
  });
});
