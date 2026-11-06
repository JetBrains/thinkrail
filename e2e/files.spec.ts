import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

test("file rows expose path, copy, paste, and confirmed delete actions", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");

	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();
	const readmeBox = await readme.boundingBox();
	if (!readmeBox) throw new Error("README row has no bounding box");
	const touch = {
		x: readmeBox.x + readmeBox.width / 2,
		y: readmeBox.y + readmeBox.height / 2,
	};
	await readme.dispatchEvent("pointerdown", {
		pointerType: "touch",
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: touch.x,
		clientY: touch.y,
	});
	await expect(page.getByTestId("file-tree-actions")).toBeVisible({ timeout: 1_500 });
	await readme.dispatchEvent("pointerup", {
		pointerType: "touch",
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 0,
		clientX: touch.x,
		clientY: touch.y,
	});
	await page.keyboard.press("Escape");

	await readme.click({ button: "right" });
	await expect(readme).toHaveClass(/bg-control-bg-selected/);
	await page.getByTestId("file-tree-copy-relative").click();
	await expect(readme).not.toHaveClass(/bg-control-bg-selected/);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("README.md");

	await readme.click({ button: "right" });
	await page.getByTestId("file-tree-copy-absolute").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		join(workspace.worktreePath, "README.md"),
	);

	await readme.click({ button: "right" });
	await page.getByTestId("file-tree-copy").click();
	await readme.click({ button: "right" });
	await page.getByTestId("file-tree-paste").click();
	const copied = page.getByTestId("file-node").filter({ hasText: "README copy.md" });
	await expect(copied).toBeVisible();
	expect(readFileSync(join(workspace.worktreePath, "README copy.md"), "utf8")).toBe(
		readFileSync(join(workspace.worktreePath, "README.md"), "utf8"),
	);

	await copied.focus();
	await page.keyboard.press("Shift+F10");
	await expect(page.getByTestId("file-tree-actions")).toBeVisible();
	await page.getByTestId("file-tree-delete").click();
	await expect(page.getByTestId("confirm-dialog")).toContainText("Delete README copy.md?");
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(copied).toBeVisible();
});

test("file and diff tabs copy paths without activating the clicked tab", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "script.ts"), "export const changed = true;\n");
	await revealWorkbenchTool(page, "files");

	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	const readmeTab = page
		.locator('[data-testid="editor-tab"][data-kind="file"]')
		.filter({ hasText: "README.md" });
	const notesTab = page
		.locator('[data-testid="editor-tab"][data-kind="file"]')
		.filter({ hasText: "notes.txt" });
	await expect(notesTab).toHaveAttribute("data-active", "true");

	await readmeTab.click({ button: "right" });
	await page.getByTestId("tab-copy-absolute-path").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		join(workspace.worktreePath, "README.md"),
	);
	await expect(notesTab).toHaveAttribute("data-active", "true");

	await readmeTab.focus();
	await page.keyboard.press("Shift+F10");
	await page.getByTestId("tab-copy-relative-path").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("README.md");
	await expect(notesTab).toHaveAttribute("data-active", "true");

	await page.getByTestId("files-mode-changed").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).dblclick();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveAttribute("data-active", "true");
	await notesTab.click();
	await expect(notesTab).toHaveAttribute("data-active", "true");

	await diffTab.click({ button: "right" });
	await page.getByTestId("tab-copy-absolute-path").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		join(workspace.worktreePath, "script.ts"),
	);
	await expect(notesTab).toHaveAttribute("data-active", "true");

	await diffTab.click({ button: "right" });
	await page.getByTestId("tab-copy-relative-path").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("script.ts");
	await expect(notesTab).toHaveAttribute("data-active", "true");

	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	const changesTab = page.locator('[data-testid="editor-tab"][data-kind="changes"]');
	await changesTab.click({ button: "right" });
	await expect(page.getByTestId("tab-copy-absolute-path")).toHaveCount(0);
	await expect(page.getByTestId("tab-copy-relative-path")).toHaveCount(0);
});
