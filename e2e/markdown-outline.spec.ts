import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
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
	return `---
title: Outline
---

# Alpha

${pad}

## Beta

${pad}

<details><summary>More</summary>

## Hidden

Folded text.

</details>

# 中文

${pad}

# Gamma

${pad}
`;
}

async function openOutlinedPreview(page: Page) {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "OUTLINE.md"), outlineDocument());
	await hideAuxiliaryWorkbench(page);
	await revealWorkbenchTool(page, "files");
	const file = page.getByTestId("file-node").filter({ hasText: "OUTLINE.md" });
	await expect(file).toBeVisible();
	await file.dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview.getByRole("heading", { name: "Alpha" })).toBeVisible();
	const outline = page.getByTestId("markdown-outline");
	await expect(outline).toBeVisible();
	return { preview, outline };
}

test("the Markdown preview outline nests headings, jumps to one, follows the reader and can be hidden", async ({
	page,
}) => {
	const { preview, outline } = await openOutlinedPreview(page);
	const entries = outline.getByTestId("markdown-outline-entry");
	await expect(entries).toHaveText(["Alpha", "Beta", "Hidden", "中文", "Gamma"]);
	await expect(
		outline.getByRole("listitem").filter({ has: page.getByText("Alpha", { exact: true }) }),
	).toContainText("Beta");
	await expect(entries.filter({ hasText: "Alpha" })).toHaveAttribute("aria-current", "location");

	const gamma = entries.filter({ hasText: "Gamma" });
	await gamma.click();
	await expect(preview.getByRole("heading", { name: "Gamma" })).toBeInViewport();
	await expect(gamma).toHaveAttribute("aria-current", "location");
	await expect(outline.locator('[aria-current="location"]')).toHaveCount(1);

	await entries.filter({ hasText: "中文" }).click();
	await expect(preview.getByRole("heading", { name: "中文" })).toBeInViewport();
	await expect(entries.filter({ hasText: "中文" })).toHaveAttribute("aria-current", "location");

	await entries.filter({ hasText: "Hidden" }).click();
	await expect(preview.locator("details")).toHaveAttribute("open", "");
	await expect(preview.getByRole("heading", { name: "Hidden" })).toBeInViewport();

	await outline.getByTestId("markdown-outline-toggle").click();
	await expect(page.getByTestId("markdown-outline")).toHaveCount(0);
	await expect(page.getByTestId("markdown-outline-toggle")).toHaveAttribute(
		"aria-pressed",
		"false",
	);
});

test("the Markdown outline position setting moves the outline to the left of the preview", async ({
	page,
}) => {
	const { preview, outline } = await openOutlinedPreview(page);
	await expect(outline).toHaveAttribute("data-side", "right");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await page.getByTestId("settings-nav-appearance").click();
	await dialog
		.getByTestId("markdown-outline-side-control")
		.getByText("Left", { exact: true })
		.click();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	await expect(outline).toHaveAttribute("data-side", "left");
	const outlineBox = await outline.boundingBox();
	const previewBox = await preview.boundingBox();
	expect(outlineBox && previewBox && outlineBox.x < previewBox.x).toBe(true);
});

test("a review card between duplicate headings leaves each outline entry on its own heading", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const pad = Array.from({ length: 28 }, (_, i) => `Filler paragraph ${i}.`).join("\n\n");
	writeFileSync(
		join(workspace.worktreePath, "REPEAT.md"),
		`# Repeat\n\nThe first section body.\n\n${pad}\n\n# Repeat\n\nThe second section body.\n\n${pad}\n`,
	);
	await hideAuxiliaryWorkbench(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "REPEAT.md" }).dblclick();
	const preview = page.getByTestId("markdown-preview");
	await preview.getByText("The first section body.").click({ clickCount: 3 });
	await page.locator('[data-testid="review-add-icon"]:visible').click();
	await page.getByTestId("review-composer-input").fill("Between the two sections.");
	await page.getByTestId("review-composer-save").click();
	await expect(preview.getByTestId("review-thread-card")).toHaveCount(1);

	const entries = page.getByTestId("markdown-outline").getByTestId("markdown-outline-entry");
	await expect(entries).toHaveText(["Repeat", "Repeat"]);
	await entries.nth(1).click();
	const headings = preview.getByRole("heading", { name: "Repeat" });
	await expect(headings.nth(1)).toBeInViewport();
	await expect(headings.nth(0)).not.toBeInViewport();
	await expect(entries.nth(1)).toHaveAttribute("aria-current", "location");
	await entries.nth(0).click();
	await expect(headings.nth(0)).toBeInViewport();
	await expect(entries.nth(0)).toHaveAttribute("aria-current", "location");
});
