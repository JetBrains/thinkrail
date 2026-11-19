import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	revealWorkbenchTool,
	worktreeRows,
} from "./fixtures/app";

test("shows files and compacts single-directory runs in the Files tree", async ({ page }) => {
	await openFixtureProject(page);

	const workspace = await createWorkspaceViaDialog(page);
	mkdirSync(join(workspace.worktreePath, "compact", "only", "here"), { recursive: true });
	writeFileSync(join(workspace.worktreePath, "compact", "only", "here", "leaf.txt"), "leaf\n");
	await expect(worktreeRows(page).first()).toBeVisible();

	await revealWorkbenchTool(page, "files");
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();

	const folderRows = page.locator('[data-testid="file-node"][data-kind="dir"]');
	const compactFolder = folderRows.filter({ hasText: /^compact\/only\/here$/ });
	const leaf = page
		.locator('[data-testid="file-node"][data-kind="file"]')
		.filter({ hasText: /^leaf\.txt[MAUR]?$/ });
	await expect(compactFolder).toBeVisible();
	await compactFolder.click();
	await expect(leaf).toBeVisible();

	mkdirSync(join(workspace.worktreePath, "compact", "only", "sibling"));
	await expect(folderRows.filter({ hasText: /^compact\/only$/ })).toBeVisible({ timeout: 10_000 });
	await expect(folderRows.filter({ hasText: /^here$/ })).toBeVisible();
	await expect(leaf).toBeVisible();
});

test("Files tree rows copy and paste files and folders, then delete them to the trash", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	mkdirSync(join(root, "pkg"));
	writeFileSync(join(root, "pkg", "a.txt"), "a\n");
	writeFileSync(join(root, "pkg", "b.txt"), "b\n");
	await revealWorkbenchTool(page, "files");

	const row = (name: string) =>
		page.getByTestId("file-node").filter({ hasText: new RegExp(`^${name}[MAUR]?$`) });
	const readme = row("README.md");
	await expect(readme).toBeVisible();

	await readme.click({ button: "right" });
	await expect(readme).toHaveClass(/bg-control-bg-selected/);
	await expect(page.getByTestId("file-tree-paste")).toHaveCount(0);
	await page.getByTestId("file-tree-copy").click();
	await expect(readme).not.toHaveClass(/bg-control-bg-selected/);

	await readme.click({ button: "right" });
	await page.getByTestId("file-tree-paste").click();
	await expect(row("README copy.md")).toBeVisible();
	await readme.click({ button: "right" });
	await page.getByTestId("file-tree-paste").click();
	await expect(row("README copy 2.md")).toBeVisible();
	expect(readFileSync(join(root, "README copy 2.md"), "utf8")).toBe(
		readFileSync(join(root, "README.md"), "utf8"),
	);

	await row("pkg").click({ button: "right" });
	await page.getByTestId("file-tree-copy").click();
	await readme.click({ button: "right" });
	await page.getByTestId("file-tree-paste").click();
	await expect(row("pkg copy")).toBeVisible();
	expect(readFileSync(join(root, "pkg copy", "b.txt"), "utf8")).toBe("b\n");

	await row("README copy.md").focus();
	await page.keyboard.press("Shift+F10");
	await page.getByTestId("file-tree-delete").click();
	const confirm = page.getByTestId("confirm-dialog");
	await expect(confirm).toContainText("Delete README copy.md?");
	await expect(confirm).toContainText("README copy.md will be moved to the trash.");
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(row("README copy.md")).toBeVisible();

	await row("README copy.md").click({ button: "right" });
	await page.getByTestId("file-tree-delete").click();
	await page.getByTestId("file-tree-delete-confirm").click();
	await expect(row("README copy.md")).toHaveCount(0);
	expect(existsSync(join(root, "README copy.md"))).toBe(false);

	await row("pkg copy").click({ button: "right" });
	await page.getByTestId("file-tree-delete").click();
	await page.getByTestId("file-tree-delete-confirm").click();
	await expect(row("pkg copy")).toHaveCount(0);
	expect(existsSync(join(root, "pkg copy"))).toBe(false);
	expect(readFileSync(join(root, "pkg", "a.txt"), "utf8")).toBe("a\n");
});

test("a copied file pastes into another workspace, including an empty tree", async ({ page }) => {
	await openFixtureProject(page);
	const source = await createWorkspaceViaDialog(page);
	writeFileSync(join(source.worktreePath, "README.md"), "copied across workspaces\n");
	await revealWorkbenchTool(page, "files");
	await page
		.getByTestId("file-node")
		.filter({ hasText: /^README\.md/ })
		.click({ button: "right" });
	await page.getByTestId("file-tree-copy").click();

	const destination = await createWorkspaceViaDialog(page);
	for (const entry of readdirSync(destination.worktreePath)) {
		if (entry !== ".git") rmSync(join(destination.worktreePath, entry), { recursive: true });
	}
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-tree-paste-root").click();
	await expect(page.getByTestId("file-node").filter({ hasText: /^README\.md/ })).toBeVisible();
	expect(readFileSync(join(destination.worktreePath, "README.md"), "utf8")).toBe(
		"copied across workspaces\n",
	);
	expect(readFileSync(join(source.worktreePath, "README.md"), "utf8")).toBe(
		"copied across workspaces\n",
	);
});
