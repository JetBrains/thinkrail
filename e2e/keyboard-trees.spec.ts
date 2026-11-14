import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
	worktreeRows,
} from "./fixtures/app";

const filesTree = (page: Page) => page.getByRole("tree", { name: "Files" });
const fileRow = (page: Page, name: string) =>
	filesTree(page)
		.getByTestId("file-node")
		.filter({ hasText: new RegExp(`^${name}[MAUR]?$`) });
const editorTab = (page: Page, name: string) =>
	page.getByTestId("editor-tab").filter({ hasText: name });

function containsFocus(container: Locator): Promise<boolean> {
	return container.evaluate((element) => element.contains(document.activeElement));
}

async function openKeyboardFolder(page: Page): Promise<string> {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	mkdirSync(join(workspace.worktreePath, "kb"));
	for (const name of ["alpha.txt", "beta.txt"]) {
		writeFileSync(join(workspace.worktreePath, "kb", name), `${name}\n`);
	}
	await revealWorkbenchTool(page, "files");
	await expect(fileRow(page, "kb")).toBeVisible();
	return workspace.worktreePath;
}

test("the Files tree is one Tab stop that arrows, Home/End and type-ahead walk", async ({
	page,
}) => {
	await openKeyboardFolder(page);
	const tree = filesTree(page);
	const items = tree.getByRole("treeitem");
	const kb = fileRow(page, "kb");
	const alpha = fileRow(page, "alpha.txt");

	await page.getByTestId("files-collapse-all").focus();
	await page.keyboard.press("Tab");
	await expect(items.first()).toBeFocused();
	await expect(tree.locator('[tabindex="0"]')).toHaveCount(1);
	await page.keyboard.press("Tab");
	await expect.poll(() => containsFocus(tree)).toBe(false);
	await page.keyboard.press("Shift+Tab");
	await expect(items.first()).toBeFocused();

	await page.keyboard.press("End");
	await expect(items.last()).toBeFocused();
	await page.keyboard.press("Home");
	await expect(items.first()).toBeFocused();

	await page.keyboard.type("kb");
	await expect(kb).toBeFocused();
	await expect(kb).toHaveAttribute("tabindex", "0");
	await expect(tree.locator('[tabindex="0"]')).toHaveCount(1);

	await page.keyboard.press("ArrowRight");
	await expect(kb).toHaveAttribute("aria-expanded", "true");
	await expect(kb).toBeFocused();
	await expect(alpha).toBeVisible();
	await page.keyboard.press("ArrowRight");
	await expect(alpha).toBeFocused();
	await expect(alpha).toHaveAttribute("aria-level", "2");
	await page.keyboard.press("ArrowDown");
	await expect(fileRow(page, "beta.txt")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(alpha).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(kb).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(kb).toHaveAttribute("aria-expanded", "false");
	await expect(alpha).toHaveCount(0);
});

test("Enter previews a file, Mod+Enter keeps it, and Delete trashes it after the confirmation", async ({
	page,
}) => {
	const root = await openKeyboardFolder(page);
	const alpha = fileRow(page, "alpha.txt");
	const beta = fileRow(page, "beta.txt");

	await fileRow(page, "kb").focus();
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	await expect(alpha).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(editorTab(page, "alpha.txt")).toHaveAttribute("data-preview", "true");
	await expect(alpha).toHaveAttribute("aria-current", "true");

	await alpha.focus();
	await page.keyboard.press("ArrowDown");
	await expect(beta).toBeFocused();
	await pressPlatformShortcut(page, "Enter");
	await expect(editorTab(page, "beta.txt")).toHaveAttribute("data-preview", "false");
	await expect(editorTab(page, "alpha.txt")).toHaveAttribute("data-preview", "true");

	await alpha.focus();
	await page.keyboard.press("Delete");
	const confirm = page.getByTestId("confirm-dialog");
	await expect(confirm).toContainText("Delete alpha.txt?");
	await page.getByTestId("file-tree-delete-confirm").click();
	await expect(alpha).toHaveCount(0);
	expect(existsSync(join(root, "kb", "alpha.txt"))).toBe(false);
	await expect(beta).toBeFocused();
});

test("Mod+Shift+E lands on the tree's current row, not its first", async ({ page }) => {
	await openKeyboardFolder(page);
	const readme = fileRow(page, "README.md");
	await readme.click();
	await expect(editorTab(page, "README.md")).toBeVisible();

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealWorkbenchTool(page, "files");
	const landing = filesTree(page).locator("[data-focus-default]");
	await expect(landing).toHaveAttribute("aria-current", "true");
	await expect(landing).toHaveText(/^README\.md/);
	await expect(filesTree(page).getByRole("treeitem").first()).not.toHaveText(/^README\.md/);

	await pressPlatformShortcut(page, "Shift+E");
	await expect(readme).toBeFocused();
});

test("a row selected while focus is elsewhere takes the landing over from the remembered row", async ({
	page,
}) => {
	await openKeyboardFolder(page);
	const readme = fileRow(page, "README.md");
	const notes = fileRow(page, "notes.txt");
	await notes.dblclick();
	await expect(editorTab(page, "notes.txt")).toBeVisible();
	await readme.dblclick();
	await expect(readme).toHaveAttribute("aria-current", "true");
	await readme.focus();

	await editorTab(page, "notes.txt").click();
	await expect(notes).toHaveAttribute("aria-current", "true");
	await pressPlatformShortcut(page, "Shift+E");
	await expect(notes).toBeFocused();
});

test("Mod+Shift+E that first mounts Files waits for its tree instead of landing on the toolbar", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(filesTree(page)).toHaveCount(0);

	await pressPlatformShortcut(page, "Shift+E");
	await expect(filesTree(page).getByRole("treeitem").first()).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => document.activeElement?.getAttribute("role")))
		.toBe("treeitem");
});

test("a workspace row opens its menu on Shift+F10, renames on F2, asks before removal on Delete, and ArrowLeft reaches its project", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const row = worktreeRows(page).first();
	const item = row.getByRole("treeitem");

	await item.focus();
	await page.keyboard.press("Shift+F10");
	await expect(page.getByTestId("workspace-actions")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("workspace-actions")).toHaveCount(0);
	await expect(item).toBeFocused();

	await page.keyboard.press("F2");
	const input = row.getByRole("textbox", { name: "Workspace name" });
	await expect(input).toBeFocused();
	await input.fill("Renamed by F2");
	await input.press("Enter");
	await expect(row.getByTestId("workspace-name")).toHaveText("Renamed by F2");
	await expect(item).toBeFocused();

	await page.keyboard.press("Delete");
	const confirm = page.getByTestId("confirm-dialog");
	await expect(confirm.getByTestId("confirm-remove")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(confirm).toHaveCount(0);
	await expect(item).toBeFocused();

	await page.keyboard.press("ArrowLeft");
	await expect(
		page.getByTestId("project-name").filter({ hasText: "sample-project" }),
	).toBeFocused();
});

test("Chats is its own flat tree: Shift+F10 opens a chat's menu, F2 does nothing and Delete asks first", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("welcome-action").filter({ hasText: "Chat without a project" }).click();
	const chats = page.getByRole("tree", { name: "Chats" });
	const item = chats.getByRole("treeitem");
	await expect(item).toHaveCount(1);
	await expect(item).toHaveAttribute("aria-current", "true");

	await item.focus();
	await page.keyboard.press("ArrowDown");
	await expect(item).toBeFocused();
	await page.keyboard.press("Shift+F10");
	await expect(page.getByTestId("chat-actions")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(item).toBeFocused();
	await page.keyboard.press("F2");
	await expect(chats.getByRole("textbox")).toHaveCount(0);

	await page.keyboard.press("Delete");
	await page.getByTestId("confirm-dialog").getByTestId("confirm-delete-chat").click();
	await expect(item).toHaveCount(0);
	await expect(page.getByTestId("add-chat")).toBeFocused();
});

test("Specs and Changes rows expand, collapse and keep-open from the keyboard", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	const specRoot = page.locator('[data-testid="spec-node"][data-spec-id="sample-root"]');
	const specChild = page.locator('[data-testid="spec-node"][data-spec-id="sample-module"]');
	await revealWorkbenchTool(page, "specs");
	await expect(specChild).toBeVisible();
	await specRoot.focus();
	await page.keyboard.press("ArrowLeft");
	await expect(specRoot).toHaveAttribute("aria-expanded", "false");
	await expect(specChild).toHaveCount(0);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	await expect(specChild).toBeFocused();
	await pressPlatformShortcut(page, "Enter");
	const specTab = page.locator('[data-testid="editor-tab"][data-kind="file"]');
	await expect(specTab).toHaveCount(1);
	await expect(specTab).toHaveAttribute("data-preview", "false");

	writeFileSync(join(workspace.worktreePath, "notes.txt"), "a note edited by e2e\n");
	await revealWorkbenchTool(page, "changes");
	const change = page.getByTestId("change-item").filter({ hasText: "notes.txt" });
	await expect(change).toBeVisible();
	await change.focus();
	await page.keyboard.press("Shift+F10");
	await expect(page.getByTestId("change-row-actions")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(change).toBeFocused();
	await pressPlatformShortcut(page, "Enter");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="diff"]')).toHaveAttribute(
		"data-preview",
		"false",
	);
});

test("Artifacts is its own tree: arrows walk it, F2 renames, Delete asks before removing and Mod+Enter keeps", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const context = join(workspace.worktreePath, ".thinkrail", "context");
	mkdirSync(context, { recursive: true });
	for (const [index, name] of ["older.md", "newer.md"].entries()) {
		writeFileSync(join(context, name), `${name}\n`);
		const time = new Date(Date.now() - (2 - index) * 60_000);
		utimesSync(join(context, name), time, time);
	}
	await revealWorkbenchTool(page, "artifacts");
	await page.getByTestId("artifacts-filter-all").click();
	const tree = page.getByRole("tree", { name: "Artifacts" });
	const items = tree.getByRole("treeitem");
	await expect(items).toHaveText(["newer.md", "older.md"]);
	const newer = items.filter({ hasText: "newer.md" });
	const older = items.filter({ hasText: "older.md" });

	await page.getByRole("toolbar", { name: "Artifacts" }).getByRole("button").last().focus();
	await page.keyboard.press("Tab");
	await expect(newer).toBeFocused();
	await expect(tree.locator('[tabindex="0"]')).toHaveCount(1);
	await page.keyboard.press("ArrowDown");
	await expect(older).toBeFocused();

	await page.keyboard.press("F2");
	const rename = page.getByTestId("artifact-name-input");
	await expect(rename).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(rename).toHaveCount(0);
	await expect(older).toBeFocused();

	await page.keyboard.press("Delete");
	const confirm = page.getByTestId("confirm-dialog");
	await expect(confirm).toContainText("Delete older.md?");
	await page.keyboard.press("Escape");
	await expect(confirm).toHaveCount(0);
	await expect(older).toBeFocused();
	await page.keyboard.press("Delete");
	await page.getByTestId("artifact-delete-confirm").click();
	await expect(older).toHaveCount(0);
	expect(existsSync(join(context, "older.md"))).toBe(false);
	await expect(newer).toBeFocused();

	await pressPlatformShortcut(page, "Enter");
	await expect(editorTab(page, "newer.md")).toHaveAttribute("data-preview", "false");
});
