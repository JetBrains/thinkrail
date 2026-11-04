import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";

const FILES = {
	"code.ts": "export const answer = 42;\n",
	"config.yaml": "name: sample\ncount: 3\n",
	"fence.md": "# Fence\n\n```sh\necho fenced\n```\n",
	"notes.zzz": "export plain words\n",
};

function visibleTokens(page: Page) {
	return page.locator('[data-testid="editor-pane"]:visible .view-line span span');
}

function visibleCode(page: Page) {
	return page.locator('[data-testid="editor-pane"]:visible .view-lines');
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
	await expect(visibleTokens(page).filter({ hasText: /export/ })).not.toHaveClass(/\bmtk1\b/);

	await openFile(page, "config.yaml", "count");
	await expect(visibleTokens(page).filter({ hasText: /^name$/ })).not.toHaveClass(/\bmtk1\b/);

	await page.getByTestId("file-node").filter({ hasText: "fence.md" }).dblclick();
	await page.getByTestId("view-toggle-code").click();
	await expect(visibleCode(page)).toContainText("echo fenced");
	await expect(visibleTokens(page).filter({ hasText: /^echo/ })).not.toHaveClass(/\bmtk1\b/);

	await openFile(page, "notes.zzz", "plain words");
	await expect(visibleTokens(page).filter({ hasText: "export plain words" })).toHaveClass(
		/\bmtk1\b/,
	);
	expect(pageErrors).toEqual([]);
});

test("without WebAssembly Monaco shows files as plain text and the page keeps working", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.addInitScript(() => Reflect.deleteProperty(globalThis, "WebAssembly"));
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "first.ts"), "export const first = 1;\n");
	await revealWorkbenchTool(page, "files");

	await openFile(page, "first.ts", "first");
	await expect(visibleTokens(page).first()).toHaveClass(/\bmtk1\b/);
	expect(pageErrors).toEqual([]);
});

async function coloredClass(page: Page, text: RegExp) {
	const token = visibleTokens(page).filter({ hasText: text }).first();
	await expect(token).not.toHaveClass(/\bmtk1\b/);
	return (await token.getAttribute("class")) ?? "";
}

test("two open files with the same first line keep their own colours", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const shared = "export const shared = 1;";
	writeFileSync(join(workspace.worktreePath, "one.ts"), `${shared}\n/* inside\nwords */\n`);
	writeFileSync(join(workspace.worktreePath, "two.ts"), `${shared}\nconst after = 2;\n`);
	await revealWorkbenchTool(page, "files");

	await openFile(page, "one.ts", "inside");
	const comment = await coloredClass(page, /words/);
	const keyword = await coloredClass(page, /export/);
	expect(comment).not.toBe(keyword);
	await openFile(page, "two.ts", "after");
	await expect(visibleTokens(page).filter({ hasText: /^const\s$/ })).toHaveClass(keyword);
	await openFile(page, "one.ts", "inside");
	await expect(visibleTokens(page).filter({ hasText: /words/ })).toHaveClass(comment);
});

test("a file changed on disk recolours in the open editor", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const file = join(workspace.worktreePath, "live.ts");
	writeFileSync(file, "export const before = 1;\n");
	await revealWorkbenchTool(page, "files");

	await openFile(page, "live.ts", "before");
	const keyword = await coloredClass(page, /export/);
	writeFileSync(file, "// comment line\nexport const later = 2;\n");
	await expect(visibleCode(page)).toContainText("later", { timeout: 15_000 });
	await expect(visibleTokens(page).filter({ hasText: /export/ })).toHaveClass(keyword);
	await expect(visibleTokens(page).filter({ hasText: /comment/ })).not.toHaveClass(keyword);
	await expect(visibleTokens(page).filter({ hasText: /comment/ })).not.toHaveClass(/\bmtk1\b/);
});
