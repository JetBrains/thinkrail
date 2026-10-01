import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { asciiPdf } from "./fixtures/repo";

test("opens a file in a center Monaco tab, focuses on re-open, and closes", async ({ page }) => {
	await openFixtureProject(page);

	await createWorkspaceViaDialog(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await page.getByTestId("tab-files").click();
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();

	await readme.dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");
	await expect(page.getByTestId("view-toggle-markdown")).toHaveAttribute("data-active", "true");

	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");
	await page.getByTestId("view-toggle-markdown").click();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");

	await readme.dblclick();
	await expect(page.getByTestId("editor-tab")).toHaveCount(1);

	const tab = page.getByTestId("editor-tab");
	await tab.hover();
	await tab.getByTestId("editor-tab-close").click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(0);
	await expect(page.getByTestId("workspace-ready")).toContainText("Workspace ready");
	await expect(page.getByTestId("workspace-ready")).toContainText(
		"Files, chats, changes, and terminals are scoped to this workspace",
	);
});

test("hides YAML frontmatter in the rendered view but shows it in source", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const spec = page.getByTestId("file-node").filter({ hasText: "SPEC.md" });
	await expect(spec).toBeVisible();
	await spec.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("Goal");
	await expect(preview).not.toContainText("goal-and-requirements");
	await expect(preview).not.toContainText("id: sample-root");

	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
	await expect(page.getByTestId("editor-pane")).toContainText("id: sample-root");
});

test("opens a non-markdown file straight to Monaco with no rendered-view toggle", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();

	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
	await expect(page.getByTestId("resource-view-toggle")).toHaveCount(0);
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
});

test("opens JSON with Tree and Source candidates, defaulting to Tree", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.json" }).dblclick();
	await expect(page.getByTestId("view-toggle-json")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("json-view")).toContainText("sample-project");
});

test("opens CSV with Table and Source candidates, defaulting to Table", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.csv" }).dblclick();
	await expect(page.getByTestId("view-toggle-csv")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("csv-view")).toContainText("Table");
});

test("opens a notebook with Notebook and Source candidates", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.ipynb" }).dblclick();
	await expect(page.getByTestId("view-toggle-notebook")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("notebook-view")).toContainText("Notebook fixture");
	await expect(page.getByTestId("notebook-view")).toContainText("notebook-output");
});

test("opens an HTML preview with active content disabled", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "sample.html" }).dblclick();
	await expect(page.getByTestId("view-toggle-html")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-code")).toBeVisible();
	await expect(page.getByTestId("html-disabled-notice")).toContainText(
		"Scripts and external resources are disabled",
	);
});

test("opens an uncompressed PDF in the PDF renderer and its change in the PDF diff", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "RENDERERS.pdf" }).dblclick();
	await expect(page.getByTestId("view-toggle-pdf")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("view-toggle-binary")).toBeVisible();
	const firstPage = page.getByTestId("pdf-view").locator("canvas").first();
	await expect(firstPage).toBeVisible();
	await expect
		.poll(() =>
			firstPage.evaluate((element) => {
				const canvas = element as HTMLCanvasElement;
				const pixels = canvas
					.getContext("2d")
					?.getImageData(0, 0, canvas.width, canvas.height).data;
				if (!pixels) return 0;
				let drawn = 0;
				for (let index = 0; index < pixels.length; index += 4) {
					if (pixels[index] < 240) drawn += 1;
				}
				return drawn;
			}),
		)
		.toBeGreaterThan(100);

	writeFileSync(join(workspace.worktreePath, "RENDERERS.pdf"), asciiPdf("CHANGED PDF FIXTURE"));
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "RENDERERS.pdf" }).click();
	await expect(page.getByTestId("pdf-diff")).toBeVisible();
	await expect(page.getByTestId("pdf-diff-page")).toHaveCount(1);
});

test("renders a PNG and opens its changed version in the 2-up image diff", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "RENDERERS.png" }).dblclick();
	await expect(page.getByTestId("view-toggle-image")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("image-resource")).toBeVisible();

	const imagePath = join(workspace.worktreePath, "RENDERERS.png");
	writeFileSync(imagePath, Buffer.concat([readFileSync(imagePath), Buffer.from("changed")]));
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "RENDERERS.png" }).click();
	await expect(page.getByTestId("image-diff-mode")).toBeVisible();
	await expect(page.getByTestId("image-diff-2-up")).toHaveAttribute("data-active", "true");
});
