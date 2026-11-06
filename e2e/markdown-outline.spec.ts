import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	revealWorkbenchTool,
} from "./fixtures/app";

function outlineDocument(): string {
	const pad = Array.from(
		{ length: 28 },
		() => "A paragraph of filler so the next heading sits below the fold.",
	).join("\n\n");
	return ["# Alpha", "", pad, "", "## Beta", "", pad, "", "# Gamma", "", pad, ""].join("\n");
}

test("the Markdown preview outline jumps to a heading and can be hidden", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "OUTLINE.md"), outlineDocument());
	await hideAuxiliaryWorkbench(page);
	await revealWorkbenchTool(page, "files");

	const file = page.getByTestId("file-node").filter({ hasText: "OUTLINE.md" });
	await expect(file).toBeVisible();
	await file.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();
	await expect(preview.getByRole("heading", { name: "Alpha" })).toBeVisible();
	await expect(page.getByTestId("view-toggle-markdown")).toHaveAttribute("data-active", "true");

	const toggle = page.getByTestId("markdown-outline-toggle");
	if ((await page.getByTestId("markdown-outline").count()) === 0) await toggle.click();
	const outline = page.getByTestId("markdown-outline");
	await expect(outline).toBeVisible();
	await expect(outline.getByTestId("markdown-outline-entry")).toHaveCount(3);

	const gamma = outline.getByTestId("markdown-outline-entry").filter({ hasText: "Gamma" });
	await gamma.click();
	await expect(preview.getByRole("heading", { name: "Gamma" })).toBeInViewport();
	await expect(gamma).toHaveAttribute("aria-current", "true");

	await outline.getByTestId("markdown-outline-toggle").click();
	await expect(page.getByTestId("markdown-outline")).toHaveCount(0);
	await expect(page.getByTestId("markdown-outline-toggle")).toBeVisible();
});
