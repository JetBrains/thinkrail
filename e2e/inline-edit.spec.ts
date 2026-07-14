import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Inline AI-editing — no-agent mechanics: selecting text in the rendered markdown view surfaces the Edit
// pill; the pill opens the instruction popup; Esc closes it. (The full agent loop — fire → edit → review →
// revert — is verified manually for v0; a tagged @agent spec is a named follow-up.)
test("selecting text in a rendered doc surfaces the Edit pill and instruction popup", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	// Select a paragraph's text via a triple-click (selects the block), then expect the pill.
	await preview.getByRole("paragraph").first().click({ clickCount: 3 });
	const pill = page.getByTestId("inline-edit-pill");
	await expect(pill).toBeVisible();

	// Clicking the pill opens the one-line instruction popup; Esc dismisses it.
	await pill.click();
	const popup = page.getByTestId("inline-edit-popup");
	await expect(popup).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(popup).toBeHidden();
});

test("⌘K opens the instruction popup for the current selection (no pill click needed)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	// Select a paragraph, then trigger the keyboard shortcut instead of clicking the pill.
	await preview.getByRole("paragraph").first().click({ clickCount: 3 });
	await expect(page.getByTestId("inline-edit-pill")).toBeVisible();
	await page.keyboard.press("ControlOrMeta+k");
	await expect(page.getByTestId("inline-edit-popup")).toBeVisible();
});
