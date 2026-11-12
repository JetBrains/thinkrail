import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";

async function workspaceWithoutChatTab(page: Page) {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	return workspace;
}

function expectClipboard(page: Page, text: string) {
	return expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
}

test("Copy path actions on a Files tree row copy that row without opening it", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const workspace = await workspaceWithoutChatTab(page);
	mkdirSync(join(workspace.worktreePath, "compact", "only", "here"), { recursive: true });
	writeFileSync(join(workspace.worktreePath, "compact", "only", "here", "leaf.txt"), "leaf\n");

	await revealWorkbenchTool(page, "files");
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();

	await readme.click({ button: "right" });
	await expect(page.getByTestId("file-copy-relative-path")).toBeVisible();
	await page.getByTestId("file-copy-path").click();
	await expectClipboard(page, join(workspace.worktreePath, "README.md"));

	await readme.click({ button: "right" });
	await page.getByTestId("file-copy-relative-path").click();
	await expectClipboard(page, "README.md");
	await expect(page.getByTestId("editor-tab")).toHaveCount(0);

	const compactFolder = page
		.locator('[data-testid="file-node"][data-kind="dir"]')
		.filter({ hasText: /^compact\/only\/here$/ });
	await expect(compactFolder).toBeVisible();
	await compactFolder.click({ button: "right" });
	await page.getByTestId("file-copy-relative-path").click();
	await expectClipboard(page, "compact/only/here");
	await compactFolder.click({ button: "right" });
	await page.getByTestId("file-copy-path").click();
	await expectClipboard(page, join(workspace.worktreePath, "compact", "only", "here"));
});

test("the Context Menu key opens a focused Files row's copy actions", async ({ page, context }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await workspaceWithoutChatTab(page);
	await revealWorkbenchTool(page, "files");
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();

	await readme.focus();
	await page.keyboard.press("Shift+F10");
	await page.getByTestId("file-copy-relative-path").click();
	await expectClipboard(page, "README.md");
	await expect(page.getByTestId("editor-tab")).toHaveCount(0);
});

test("Copy path actions on a file tab copy that tab without activating it", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const workspace = await workspaceWithoutChatTab(page);

	await revealWorkbenchTool(page, "files");
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();
	await readme.dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	const readmeTab = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	const notesTab = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await expect(notesTab).toHaveAttribute("data-active", "true");
	await expect(readmeTab).toHaveAttribute("data-active", "false");

	await readmeTab.click({ button: "right" });
	await page.getByTestId("tab-copy-path").click();
	await expectClipboard(page, join(workspace.worktreePath, "README.md"));

	await readmeTab.click({ button: "right" });
	await page.getByTestId("tab-copy-relative-path").click();
	await expectClipboard(page, "README.md");
	await expect(readmeTab).toHaveAttribute("data-active", "false");
	await expect(notesTab).toHaveAttribute("data-active", "true");
});

test("chat tabs do not offer path copy actions", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]').first();
	await expect(chatTab).toBeVisible();
	await chatTab.click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "Focus tab" })).toBeVisible();
	await expect(page.getByTestId("tab-copy-path")).toHaveCount(0);
	await expect(page.getByTestId("tab-copy-relative-path")).toHaveCount(0);
});
