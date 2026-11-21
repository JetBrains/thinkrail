import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";

test.use({ viewport: { width: 1280, height: 760 } });

const LINE = 40;

const filesTree = (page: Page) => page.getByRole("tree", { name: "Files" });
const fileRow = (page: Page, name: string) =>
	filesTree(page)
		.getByTestId("file-node")
		.filter({ hasText: new RegExp(`^${name.replace(".", "\\.")}[MAUR]?$`) });
const pane = (page: Page) => page.locator('[data-testid="editor-pane"]:visible');

function longMarkdown(): string {
	const intro = Array.from({ length: 6 }, (_, index) => `Opening paragraph ${index + 1}.`);
	const fence = Array.from({ length: 60 }, (_, index) => `config line ${index + 1}`);
	const outro = Array.from({ length: 20 }, (_, index) => `Closing paragraph ${index + 1}.`);
	return [
		"# Reading keys",
		...intro,
		["```text", ...fence, "```"].join("\n"),
		...outro,
		"The last block.",
	].join("\n\n");
}

async function openReadingFolder(page: Page): Promise<string> {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	writeFileSync(join(root, "LONG.md"), `${longMarkdown()}\n`);
	writeFileSync(
		join(root, "app.ts"),
		`${Array.from({ length: 200 }, (_, index) => `export const value${index + 1} = ${index + 1};`).join("\n")}\n`,
	);
	const header = Array.from({ length: 16 }, (_, col) => `column_${col + 1}_with_a_long_heading`);
	const rows = Array.from({ length: 120 }, (_, row) =>
		header.map((_name, col) => `row ${row + 1} cell ${col + 1}`).join(","),
	);
	writeFileSync(join(root, "data.csv"), `${[header.join(","), ...rows].join("\n")}\n`);
	const paragraphs = Array.from({ length: 80 }, (_, index) => `<p>Paragraph ${index + 1}</p>`);
	writeFileSync(join(root, "page.html"), `<!doctype html><body>${paragraphs.join("")}</body>\n`);
	await revealWorkbenchTool(page, "files");
	await expect(fileRow(page, "LONG.md")).toBeVisible();
	return root;
}

async function scrollTop(scroller: Locator): Promise<number> {
	return scroller.evaluate((element) => element.scrollTop);
}

async function openByKeyboard(page: Page, name: string): Promise<void> {
	await fileRow(page, name).focus();
	await page.keyboard.press("Enter");
}

test("Enter in the Files tree opens the file and moves focus into it, a click keeps it in the tree, Esc returns to the row", async ({
	page,
}) => {
	await openReadingFolder(page);
	await openByKeyboard(page, "LONG.md");
	const preview = pane(page).getByTestId("markdown-preview");
	const cursor = preview.getByTestId("review-cursor");
	await expect(cursor).toBeFocused();
	await expect(preview.locator("[data-review-block-cursor]")).toHaveText("Reading keys");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "LONG.md" })).toHaveAttribute(
		"data-active",
		"true",
	);

	await page.keyboard.press("Escape");
	await expect(fileRow(page, "LONG.md")).toBeFocused();

	await fileRow(page, "README.md").click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveAttribute(
		"data-active",
		"true",
	);
	await expect(pane(page).getByTestId("markdown-preview")).toContainText("sample-project");
	await page.waitForTimeout(300);
	await expect(fileRow(page, "README.md")).toBeFocused();

	await pressPlatformShortcut(page, "k");
	const query = page.getByTestId("search-input");
	await query.fill("/data.csv");
	const hit = page.locator('[data-testid="search-row"][data-kind="file"]', { hasText: "data.csv" });
	await expect(hit).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("search-host-pending")).toHaveCount(0);
	await query.press("Enter");
	const table = pane(page).locator('[data-testid="csv-view"] [data-virtuoso-scroller]');
	await expect(table).toBeFocused();
});

function focusedPlace(page: Page) {
	return page.evaluate(() => {
		const active = document.activeElement;
		return {
			tag: active?.tagName ?? null,
			region: active?.closest("[data-region]")?.getAttribute("data-region-kind") ?? null,
		};
	});
}

test("an HTML file opened with Enter never takes the keyboard into its frame: F6, Esc and the chords still leave", async ({
	page,
}) => {
	await openReadingFolder(page);
	await openByKeyboard(page, "page.html");
	const frame = pane(page).locator('[data-testid="html-frame-box"] iframe');
	await expect(frame.contentFrame().getByText("Paragraph 1", { exact: true })).toBeVisible();
	const tab = page.getByTestId("editor-tab").filter({ hasText: "page.html" }).getByRole("tab");
	await expect(tab).toBeFocused({ timeout: 10_000 });

	await page.keyboard.press("F6");
	await expect.poll(() => focusedPlace(page)).toMatchObject({ tag: "BUTTON" });
	expect((await focusedPlace(page)).region).not.toBe("center");
	await page.keyboard.press("Shift+F6");
	await expect(tab).toBeFocused();

	const inPane = () =>
		pane(page).evaluate((element) => ({
			inside: element.contains(document.activeElement),
			tag: document.activeElement?.tagName ?? null,
		}));
	await page.keyboard.press("Escape");
	await expect.poll(inPane).toEqual({ inside: true, tag: "BUTTON" });
	await page.keyboard.press("Escape");
	await expect(fileRow(page, "page.html")).toBeFocused();

	await pressPlatformShortcut(page, "1");
	await expect.poll(inPane).toEqual({ inside: true, tag: "BUTTON" });
	await pressPlatformShortcut(page, "Shift+E");
	await expect(fileRow(page, "page.html")).toBeFocused();
});

test("j/k, Space and g/G read a Markdown file, and ↓ scrolls a tall block before the cursor moves on", async ({
	page,
}) => {
	await openReadingFolder(page);
	await openByKeyboard(page, "LONG.md");
	const preview = pane(page).getByTestId("markdown-preview");
	const cursor = preview.getByTestId("review-cursor");
	const block = preview.locator("[data-review-block-cursor]");
	await expect(cursor).toBeFocused();

	await page.keyboard.press("j");
	await expect(block).toHaveText("Opening paragraph 1.");
	const fence = preview.locator("pre").first();
	for (let press = 0; press < 12; press += 1) {
		if ((await block.evaluate((element) => element.tagName)) === "PRE") break;
		await page.keyboard.press("j");
	}
	await expect(block).toHaveJSProperty("tagName", "PRE");
	const fenceTail = () =>
		fence.evaluate((element) => {
			const scroller = element.closest<HTMLElement>('[data-testid="markdown-preview"]');
			if (!scroller) throw new Error("no scroller");
			const box = scroller.getBoundingClientRect();
			return element.getBoundingClientRect().bottom - (box.top + scroller.clientHeight);
		});
	expect(await fenceTail()).toBeGreaterThan(3 * LINE);
	const before = await scrollTop(preview);
	for (let press = 0; press < 3; press += 1) await page.keyboard.press("ArrowDown");
	await expect.poll(() => scrollTop(preview)).toBe(before + 3 * LINE);
	await expect(block).toHaveJSProperty("tagName", "PRE");
	let tail = Number.POSITIVE_INFINITY;
	for (let press = 0; press < 60; press += 1) {
		if ((await block.evaluate((element) => element.tagName)) !== "PRE") break;
		tail = await fenceTail();
		await page.keyboard.press("j");
	}
	await expect(block).toHaveText("Closing paragraph 1.");
	expect(tail).toBeLessThanOrEqual(1);
	await page.keyboard.press("k");
	await expect(block).toHaveJSProperty("tagName", "PRE");

	const height = await preview.evaluate((element) => element.clientHeight);
	const paged = await scrollTop(preview);
	await page.keyboard.press("Space");
	await expect.poll(() => scrollTop(preview)).toBe(paged + height - LINE);
	await page.keyboard.press("Shift+Space");
	await expect.poll(() => scrollTop(preview)).toBe(paged);

	await page.keyboard.press("Shift+G");
	await expect
		.poll(() =>
			preview.evaluate(
				(element) => element.scrollHeight - element.clientHeight - element.scrollTop,
			),
		)
		.toBeLessThanOrEqual(1);
	await expect(block).toHaveText("The last block.");
	await page.keyboard.press("g");
	await expect.poll(() => scrollTop(preview)).toBe(0);
	await expect(block).toHaveText("Reading keys");
	await expect(cursor).toBeFocused();
});

test("a table scrolls by line, page and sideways, then Esc goes back to its row", async ({
	page,
}) => {
	await openReadingFolder(page);
	await openByKeyboard(page, "data.csv");
	const table = pane(page).locator('[data-testid="csv-view"] [data-virtuoso-scroller]');
	await expect(table).toBeFocused();
	await expect(table.getByText("row 12 cell 1", { exact: true })).toBeVisible();
	await page.keyboard.press("j");
	await expect.poll(() => scrollTop(table)).toBe(LINE);
	const height = await table.evaluate((element) => element.clientHeight);
	await page.keyboard.press("Space");
	await expect.poll(() => scrollTop(table)).toBe(LINE + height - LINE);
	await page.keyboard.press("l");
	await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBe(LINE);
	await page.keyboard.press("h");
	await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBe(0);
	await page.keyboard.press("Shift+G");
	await expect
		.poll(() =>
			table.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
		)
		.toBeLessThanOrEqual(1);
	await page.keyboard.press("Escape");
	await expect(fileRow(page, "data.csv")).toBeFocused();
});

async function editorState(editor: Locator) {
	return editor.evaluate((root) => {
		const active = root.querySelector(".line-numbers.active-line-number");
		const first = Array.from(root.querySelectorAll<HTMLElement>(".view-line")).find((line) =>
			line.textContent?.replace(/\u00a0/g, " ").startsWith("export const value1 ="),
		);
		const view = root.getBoundingClientRect();
		return {
			line: Number(active?.textContent ?? 0),
			top: first ? Math.round(first.getBoundingClientRect().top - view.top) : null,
			focused: root.contains(document.activeElement),
			message: root.querySelector(".monaco-editor-overlaymessage") !== null,
		};
	});
}

test("read-only code reads with j/k, Space and g/G, F labels the page, and Esc returns to the tree", async ({
	page,
}) => {
	await openReadingFolder(page);
	await openByKeyboard(page, "app.ts");
	const editor = pane(page).locator(".monaco-editor");
	await expect.poll(async () => (await editorState(editor)).focused).toBe(true);
	await expect.poll(async () => (await editorState(editor)).line).toBe(1);

	const lineHeight = await editor.evaluate(
		(root) => root.querySelector<HTMLElement>(".view-line")?.getBoundingClientRect().height ?? 0,
	);
	expect(lineHeight).toBeGreaterThan(0);
	const start = (await editorState(editor)).top;
	if (start === null) throw new Error("the first line is not rendered");
	await page.keyboard.press("j");
	await expect.poll(async () => (await editorState(editor)).line).toBe(2);
	await expect
		.poll(async () => (await editorState(editor)).top)
		.toBe(Math.round(start - lineHeight));
	expect((await editorState(editor)).message).toBe(false);
	await page.keyboard.press("k");
	await expect.poll(async () => (await editorState(editor)).line).toBe(1);
	await expect.poll(async () => (await editorState(editor)).top).toBe(start);

	await page.keyboard.press("Space");
	await expect.poll(async () => (await editorState(editor)).line).toBeGreaterThan(10);
	await page.keyboard.press("Shift+G");
	await expect.poll(async () => (await editorState(editor)).line).toBe(201);
	await page.keyboard.press("g");
	await expect.poll(async () => (await editorState(editor)).line).toBe(1);
	expect((await editorState(editor)).message).toBe(false);

	await page.keyboard.press("f");
	await expect(page.getByTestId("hint-mode")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("hint-mode")).toHaveCount(0);
	await expect.poll(async () => (await editorState(editor)).focused).toBe(true);

	await page.keyboard.press("Escape");
	await expect(fileRow(page, "app.ts")).toBeFocused();
});
