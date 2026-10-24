import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";

const FILES = {
	"code.ts": "export const answer = 42;\n",
	"config.yaml": "name: sample\ncount: 3\n",
	"fence.md": "# Fence\n\n```ts\nexport const fenced = 1;\n```\n",
	"notes.zzz": "export plain words\n",
};

function visibleTokens(page: Page) {
	return page.locator('[data-testid="editor-pane"]:visible .view-line span span');
}

async function openFile(page: Page, name: string, text: string) {
	await page.getByTestId("file-node").filter({ hasText: name }).dblclick();
	await expect(page.locator('[data-testid="editor-pane"]:visible')).toContainText(text);
}

test("Monaco colours each catalog language on first use and leaves unknown files plain", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	for (const [name, content] of Object.entries(FILES)) {
		writeFileSync(join(workspace.worktreePath, name), content);
	}
	await revealWorkbenchTool(page, "files");

	await openFile(page, "code.ts", "answer");
	await expect(visibleTokens(page).filter({ hasText: /^export$/ })).not.toHaveClass(/\bmtk1\b/);

	await openFile(page, "config.yaml", "count");
	await expect(visibleTokens(page).filter({ hasText: /^name$/ })).not.toHaveClass(/\bmtk1\b/);

	await page.getByTestId("file-node").filter({ hasText: "fence.md" }).dblclick();
	await page.getByTestId("view-toggle-code").click();
	await expect(page.locator('[data-testid="editor-pane"]:visible')).toContainText("fenced");
	await expect(visibleTokens(page).filter({ hasText: /^export$/ })).not.toHaveClass(/\bmtk1\b/);

	await openFile(page, "notes.zzz", "plain words");
	await expect(visibleTokens(page).filter({ hasText: "export plain words" })).toHaveClass(
		/\bmtk1\b/,
	);
	expect(pageErrors).toEqual([]);
});
