import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Fenced ```mermaid blocks render as themed diagrams in the rendered markdown view (the shared
// `chat/Markdown` mermaid path): a valid fence becomes an SVG with the fullscreen affordance, an
// invalid fence falls back to the error + source view, and a plain code fence is untouched. Backed
// by the DIAGRAM.md fixture seeded in global-setup.
test("renders mermaid fences as diagrams in the rendered markdown view", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const file = page.getByTestId("file-node").filter({ hasText: "DIAGRAM.md" });
	await expect(file).toBeVisible();
	await file.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	// The valid fence renders a real <svg> (lazy mermaid chunk → generous timeout), the invalid one
	// surfaces the parse error with its source still shown; exactly one of each.
	await expect(preview.getByTestId("mermaid-svg").locator("svg")).toBeVisible({ timeout: 20_000 });
	await expect(preview.getByTestId("mermaid-svg")).toHaveCount(1);
	const error = preview.getByTestId("mermaid-error");
	await expect(error).toHaveCount(1);
	await expect(error).toContainText("broken");

	// A non-mermaid fence stays an ordinary code block.
	await expect(preview.locator("pre.shiki", { hasText: "plain-fence-stays-code" })).toBeVisible();

	// Fullscreen opens the pan-zoom dialog.
	await preview.getByTestId("mermaid-fullscreen").click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);

	// Source view shows the raw fence again.
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("flowchart TD; Start --> Finish");
});
