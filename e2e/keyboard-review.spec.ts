import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { KeybindingOverrides } from "@thinkrail/contracts";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";
import { resetKeybindings, setKeybindings } from "./fixtures/keybindings";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
const ORIGINAL = Array.from({ length: 10 }, (_, index) => `const l${index + 1} = ${index + 1};`);
const MODIFIED = [
	...ORIGINAL.slice(0, 4),
	"const l5a = 50;",
	"const l5b = 51;",
	...ORIGINAL.slice(5, 7),
	...ORIGINAL.slice(8),
];

const CURSOR_ORIGINAL = `${ORIGINAL.join("\n")}\n`;
const CURSOR_MODIFIED = `${MODIFIED.join("\n")}\n`;

interface Comment {
	id: string;
	body: string;
	status: string;
	anchor: { path: string; side: string; selectors: Record<string, unknown>[] } | null;
}

function persistedComments(): Comment[] {
	const dir = join(E2E_DATA_DIR, "reviews");
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.flatMap(
			(name) =>
				(JSON.parse(readFileSync(join(dir, name), "utf8")) as { comments: Comment[] }).comments,
		);
}

function lineRangeOf(comment: Comment | undefined) {
	return comment?.anchor?.selectors.find((selector) => selector.kind === "lineRange");
}

async function commitAndModify(
	page: Page,
	workspaceId: string,
	name: string,
	original: string | Buffer,
	modified: string | Buffer,
): Promise<void> {
	writeFileSync(join(worktree(), name), original);
	execSync(`git -C "${worktree()}" add ${name} && git -C "${worktree()}" commit -m "add ${name}"`, {
		stdio: "ignore",
	});
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("workspace.setDiffBase", { id: workspaceId, ref: "HEAD" });
	} finally {
		wire.close();
	}
	writeFileSync(join(worktree(), name), modified);
}

function png(width: number, height: number, rgb: [number, number, number]): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([length, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(Buffer.concat(Array(height).fill(row)))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

async function tabTo(page: Page, target: Locator, limit = 60): Promise<void> {
	for (let step = 0; step < limit; step += 1) {
		if (await target.evaluate((node) => node === document.activeElement)) return;
		await page.keyboard.press("Tab");
	}
	await expect(target).toBeFocused();
}

const cursorProxy = (surface: Locator) => surface.getByTestId("review-cursor");

async function expectCursorOption(
	surface: Locator,
	text: string,
	position: number,
	size: number,
): Promise<void> {
	const option = cursorProxy(surface).getByRole("option");
	await expect(option).toHaveCount(1);
	await expect(option).toHaveAccessibleName(text);
	await expect(option).toHaveText("");
	await expect(option).toHaveAttribute("aria-selected", "true");
	await expect(option).toHaveAttribute("aria-posinset", String(position));
	await expect(option).toHaveAttribute("aria-setsize", String(size));
	expect(
		await cursorProxy(surface).evaluate(
			(proxy) =>
				proxy.querySelector('[role="option"]')?.id === proxy.getAttribute("aria-activedescendant"),
		),
	).toBe(true);
}

async function expectHonestSurface(surface: Locator): Promise<void> {
	const proxy = cursorProxy(surface);
	await expect(proxy).toHaveAttribute("role", "listbox");
	await expect(proxy).toHaveAttribute("tabindex", "0");
	await expect(proxy).not.toHaveAttribute("aria-multiselectable");
	await expect(surface).not.toHaveAttribute("role");
	await expect(surface).not.toHaveAttribute("tabindex");
	await expect(surface).toHaveCSS("outline-style", "solid");
}

async function openCursorDiff(
	page: Page,
	keybindings?: KeybindingOverrides,
): Promise<{
	diff: Locator;
	cursor: Locator;
	workspaceId: string;
}> {
	await openFixtureProject(page);
	if (keybindings) await setKeybindings(page, keybindings);
	const workspace = await createWorkspaceViaDialog(page);
	await commitAndModify(page, workspace.id, "cursor.ts", CURSOR_ORIGINAL, CURSOR_MODIFIED);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "cursor.ts" }).dblclick();
	const diff = page.getByTestId("diff-view");
	await expect(diff.getByText("l5b = 51", { exact: false }).last()).toBeVisible();
	await page.locator('[data-testid="editor-tab"][data-active="true"]').click();
	const cursor = cursorProxy(diff);
	await tabTo(page, cursor);
	return { diff, cursor, workspaceId: workspace.id };
}

function markSentOnDisk(commentId: string): void {
	const dir = join(E2E_DATA_DIR, "reviews");
	for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
		const file = join(dir, name);
		const snapshot = JSON.parse(readFileSync(file, "utf8"));
		const comment = snapshot.comments.find(
			(candidate: { id: string }) => candidate.id === commentId,
		);
		if (!comment) continue;
		comment.status = "sent";
		comment.sentAt = Date.now();
		comment.sessionId = "sess-e2e";
		writeFileSync(file, `${JSON.stringify(snapshot, null, "\t")}\n`);
		return;
	}
	throw new Error(`No persisted review comment ${commentId}`);
}

async function comment(page: Page, text: string): Promise<void> {
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("review-composer-input")).toBeFocused();
	await page.keyboard.type(text);
}

const cursorRow = (diff: Locator, side: "deletions" | "additions", line: number) =>
	diff.locator(`[data-${side}] [data-line="${line}"][data-selected-line]`);
const cursorSide = (diff: Locator) => diff.locator("diffs-container");

test("a Pierre diff is one Tab stop with a line cursor: lines, sides, a range, a draft and back", async ({
	page,
}) => {
	const { diff, cursor } = await openCursorDiff(page);
	await expectHonestSurface(diff);
	await expect(cursorRow(diff, "additions", 5)).toHaveCount(1);
	await expect(cursorSide(diff)).toHaveClass(/review-cursor-additions/);
	await expectCursorOption(diff, "New line 5: const l5a = 50;", 5, 10);

	await page.keyboard.press("j");
	await expect(cursorRow(diff, "additions", 6)).toHaveCount(1);
	await expect(cursorRow(diff, "additions", 5)).toHaveCount(0);
	await page.keyboard.press("h");
	await expect(cursorRow(diff, "additions", 6)).toHaveCount(1);
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("h");
	await expect(cursorSide(diff)).toHaveClass(/review-cursor-deletions/);
	await expect(cursorRow(diff, "deletions", 5)).toHaveCount(1);
	await expectCursorOption(diff, "Old line 5: const l5 = 5;", 5, 10);
	await page.keyboard.press("j");
	await expect(cursorRow(diff, "deletions", 6)).toHaveCount(1);
	await page.keyboard.press("k");
	await page.keyboard.press("l");
	await expect(cursorSide(diff)).toHaveClass(/review-cursor-additions/);
	await page.keyboard.press("End");
	await expect(cursorRow(diff, "additions", 10)).toHaveCount(1);
	await page.keyboard.press("Home");
	await expect(cursorRow(diff, "additions", 1)).toHaveCount(1);
	for (let line = 1; line < 5; line += 1) await page.keyboard.press("ArrowDown");

	await page.keyboard.press("Shift+J");
	await page.keyboard.press("Shift+ArrowDown");
	await expect(diff.locator("[data-additions] [data-line][data-selected-line]")).toHaveCount(3);
	await expectCursorOption(diff, "New line 7: const l6 = 6; (selection: Lines 5–7)", 7, 10);
	await page.keyboard.press("Enter");
	const composer = page.getByTestId("review-composer");
	await expect(composer).toContainText("Lines 5–7");
	await expect(page.getByTestId("review-composer-input")).toBeFocused();
	await page.keyboard.type("Range remark.");
	await pressPlatformShortcut(page, "Enter");
	await expect(composer).toHaveCount(0);
	await expect(cursor).toBeFocused();
	await expect.poll(() => persistedComments().length).toBe(1);
	const [saved] = persistedComments();
	expect(saved?.anchor?.side).toBe("worktree");
	expect(lineRangeOf(saved)).toMatchObject({ startLine: 5, endLine: 7 });

	await page.keyboard.press("Tab");
	const edit = diff.getByTestId("review-thread-edit");
	await expect(edit).toBeFocused();
	await page.keyboard.type(" More.");
	await pressPlatformShortcut(page, "Enter");
	await expect(cursor).toBeFocused();
	await expect.poll(() => persistedComments()[0]?.body).toBe("Range remark. More.");
	await expect(cursorRow(diff, "additions", 7)).toHaveCount(1);
	await expect(edit).toBeEnabled();

	await page.keyboard.press("Tab");
	await expect(edit).toBeFocused();
	await page.keyboard.type(" Scratch.");
	await page.keyboard.press("Escape");
	await expect(cursor).toBeFocused();
	await expect(edit).toHaveValue("Range remark. More.");

	await page.keyboard.press("Escape");
	await expect(cursor).not.toBeFocused();
	expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test("a virtualized diff scrolls the cursor's line into view as it jumps between far hunks", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const lines = Array.from({ length: 1_500 }, (_, index) => `far line ${index + 1}`);
	const changed = lines.map((line, index) =>
		index === 4 || index === 1_399 ? `${line} edited` : line,
	);
	await commitAndModify(
		page,
		workspace.id,
		"FAR.txt",
		`${lines.join("\n")}\n`,
		`${changed.join("\n")}\n`,
	);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "FAR.txt" }).dblclick();
	const diff = page.getByTestId("diff-view");
	await expect(diff.getByText("far line 5 edited").last()).toBeVisible();
	await page.locator('[data-testid="editor-tab"][data-active="true"]').click();
	const cursor = cursorProxy(diff);
	await tabTo(page, cursor);
	await expect(cursorRow(diff, "additions", 5)).toHaveCount(1);

	await page.keyboard.press("End");
	await expect(cursorRow(diff, "additions", 1404)).toBeInViewport();
	const scrolled = await diff.evaluate((node) => node.scrollTop);
	expect(scrolled).toBeGreaterThan(0);
	await page.keyboard.press("Shift+Tab");
	await expect(cursor).not.toBeFocused();
	await page.keyboard.press("Tab");
	await expect(cursor).toBeFocused();
	expect(await diff.evaluate((node) => node.scrollTop)).toBe(scrolled);
	await page.keyboard.press("k");
	await expect(cursorRow(diff, "additions", 1403)).toBeInViewport();
	await page.keyboard.press("Home");
	await expect(cursorRow(diff, "additions", 1)).toBeInViewport();
});

test("Delete and Send keep focus on the card's line, and Shift+Mod+Enter sends at once", async ({
	page,
}) => {
	const sent: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { method?: string; params?: { id?: string } };
			if (frame.method === "review.sendComment") {
				sent.push(frame.params?.id ?? "");
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
	const { diff, cursor } = await openCursorDiff(page);
	const cards = diff.getByTestId("review-thread-card");

	await page.keyboard.press("j");
	await comment(page, "Keep me.");
	await pressPlatformShortcut(page, "Enter");
	await expect(cards).toHaveCount(1);
	await expect(cursor).toBeFocused();
	for (let step = 0; step < 3; step += 1) await page.keyboard.press("j");
	await comment(page, "Delete me.");
	await pressPlatformShortcut(page, "Enter");
	await expect(cards).toHaveCount(2);
	await expect(cursor).toBeFocused();

	await page.keyboard.press("Tab");
	await expect(page.locator('[data-testid="review-thread-edit"]:focus')).toHaveValue("Delete me.");
	await page.keyboard.press("Shift+Tab");
	await expect(page.locator('[data-testid="review-thread-delete"]:focus')).toHaveCount(1);
	await page.keyboard.press("Enter");
	await expect(cards).toHaveCount(1);
	await expect(cursor).toBeFocused();
	await expect(cursorRow(diff, "additions", 9)).toHaveCount(1);

	await page.keyboard.press("Home");
	await page.keyboard.press("Tab");
	await expect(cards.getByTestId("review-thread-edit")).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("Shift+Tab");
	await expect(cards.getByTestId("review-thread-send")).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(cursor).toBeFocused();
	await expect(cursorRow(diff, "additions", 6)).toHaveCount(1);
	const keep = persistedComments().find((comment) => comment.body === "Keep me.");
	await expect.poll(() => sent).toEqual([keep?.id]);

	await page.keyboard.press("j");
	await comment(page, "Send me now.");
	await pressPlatformShortcut(page, "Shift+Enter");
	await expect.poll(() => sent.length).toBe(2);
	const now = persistedComments().find((comment) => comment.body === "Send me now.");
	expect(sent[1]).toBe(now?.id);
	expect(lineRangeOf(now)).toMatchObject({ startLine: 7, endLine: 7 });
});

test("Show in file lands in a draft's text, not on its Send button; a sent card takes focus", async ({
	page,
}) => {
	const { diff, cursor, workspaceId } = await openCursorDiff(page);
	await comment(page, "Sent soon.");
	await pressPlatformShortcut(page, "Enter");
	await expect(cursor).toBeFocused();
	for (let step = 0; step < 4; step += 1) await page.keyboard.press("j");
	await comment(page, "Reveal me.");
	await pressPlatformShortcut(page, "Enter");
	await expect(cursor).toBeFocused();
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(2);
	await expect.poll(() => persistedComments().length).toBe(2);
	const sentSoon = persistedComments().find((candidate) => candidate.body === "Sent soon.");
	const reveal = persistedComments().find((candidate) => candidate.body === "Reveal me.");
	markSentOnDisk(sentSoon?.id ?? "");
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("review.commentUpdate", {
			workspaceId,
			id: reveal?.id ?? "",
			body: "Reveal me.",
		});
	} finally {
		wire.close();
	}
	const sentCard = diff.locator('[data-testid="review-thread-card"][data-status="sent"]');
	await expect(sentCard).toHaveCount(1);
	await page.keyboard.press("Home");
	await page.keyboard.press("Tab");
	await expect(sentCard).toBeFocused();

	await revealWorkbenchTool(page, "review");
	const reviewSection = page
		.getByTestId("review-file-section")
		.filter({ has: page.getByTestId("review-file-row").filter({ hasText: "cursor.ts" }) });
	if ((await reviewSection.getAttribute("data-expanded")) !== "true") {
		await reviewSection.getByTestId("review-file-row").click();
	}
	await reviewSection
		.getByTestId("review-comment")
		.filter({ hasText: "Reveal me." })
		.getByTestId("review-comment-open")
		.click();
	const focused = page.locator('[data-testid="review-thread-edit"]:focus');
	await expect(focused).toHaveCount(1);
	await expect(focused).toHaveValue("Reveal me.");
	const caret = await focused.evaluate((node) =>
		node instanceof HTMLTextAreaElement ? [node.selectionStart, node.value.length] : null,
	);
	expect(caret).toEqual([10, 10]);
	await expect(page.locator('[data-testid="review-thread-send"]:focus')).toHaveCount(0);
});

test("in Changes review the cursor owns J while V still marks the file viewed", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await commitAndModify(page, workspace.id, "cursor.ts", CURSOR_ORIGINAL, CURSOR_MODIFIED);
	writeFileSync(join(worktree(), "notes.txt"), "a note edited by e2e\n");
	await revealWorkbenchTool(page, "changes");
	const row = page.getByTestId("change-item").filter({ hasText: "cursor.ts" });
	await row.click();
	const section = page.locator('[data-testid="changes-section"][data-path="cursor.ts"]');
	const diff = section.getByTestId("diff-view");
	await expect(diff.getByText("l5b = 51", { exact: false }).last()).toBeVisible();
	await expect(row).toHaveAttribute("data-active", "true");
	await section.getByTestId("changes-section-toggle").focus();
	await tabTo(page, cursorProxy(diff));
	await expect(cursorRow(diff, "additions", 5)).toHaveCount(1);

	await page.keyboard.press("j");
	await expect(cursorRow(diff, "additions", 6)).toHaveCount(1);
	await expect(row).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("0/2 viewed");
	await page.keyboard.press("v");
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/2 viewed");
	await expect(section).toHaveAttribute("data-viewed", "true");

	await page.keyboard.press("Escape");
	await expect(section.getByTestId("changes-section-toggle")).toBeFocused();
});

test.describe("rebound review keys", () => {
	test.afterEach(async ({ page }) => resetKeybindings(page));

	test("a rebound mark-viewed key marks the file viewed and V no longer does", async ({ page }) => {
		await openFixtureProject(page);
		await setKeybindings(page, { "review.markViewed": ["KeyU"] });
		const workspace = await createWorkspaceViaDialog(page);
		await commitAndModify(page, workspace.id, "cursor.ts", CURSOR_ORIGINAL, CURSOR_MODIFIED);
		writeFileSync(join(worktree(), "notes.txt"), "a note edited by e2e\n");
		await revealWorkbenchTool(page, "changes");
		const row = page.getByTestId("change-item").filter({ hasText: "cursor.ts" });
		await row.click();
		const section = page.locator('[data-testid="changes-section"][data-path="cursor.ts"]');
		await expect(section.getByTestId("diff-view")).toBeVisible();
		const viewed = page.getByTestId("changes-review-viewed-count");
		await expect(viewed).toHaveText("0/2 viewed");

		await section.getByTestId("changes-section-toggle").focus();
		await expect(async () => {
			await page.keyboard.press("u");
			await expect(viewed).toHaveText("1/2 viewed", { timeout: 1_000 });
		}).toPass();
		await page.keyboard.press("v");
		await page.keyboard.press("u");
		await expect(viewed).toHaveText("0/2 viewed");
		await expect(section).not.toHaveAttribute("data-viewed", "true");
	});

	test("a comment rebound onto Alt+Tab opens the composer from the diff cursor instead of its Tab walk", async ({
		page,
	}) => {
		const { cursor } = await openCursorDiff(page, { "review.surface.comment": ["Alt+Tab"] });
		await expect(cursor).toBeFocused();
		await page.keyboard.press("Alt+Tab");
		await expect(page.getByTestId("review-composer-input")).toBeFocused();
	});

	test("an arrow twin rebound onto Mod+J extends the cursor's range with Shift+Mod+J instead of toggling the bottom panel", async ({
		page,
	}) => {
		const { diff, cursor } = await openCursorDiff(page, { "arrows.down": ["Mod+KeyJ"] });
		const bottom = page.getByTestId("bottom-panel");
		const bottomShown = await bottom.count();
		await expect(cursorRow(diff, "additions", 5)).toHaveCount(1);
		await pressPlatformShortcut(page, "J");
		await expect(cursorRow(diff, "additions", 6)).toHaveCount(1);
		await pressPlatformShortcut(page, "Shift+J");
		await expect(diff.locator("[data-additions] [data-line][data-selected-line]")).toHaveCount(2);
		await expect(cursorRow(diff, "additions", 7)).toHaveCount(1);
		await expect(cursor).toBeFocused();
		await expect(bottom).toHaveCount(bottomShown);
	});
});

test("the cheatsheet opened from a review surface highlights the review keys and shows them", async ({
	page,
}) => {
	const { cursor } = await openCursorDiff(page);
	await pressPlatformShortcut(page, "Shift+Slash");
	const shortcuts = page.getByTestId("shortcuts-dialog");
	await expect(shortcuts.getByTestId("shortcuts-section").first()).toHaveAttribute(
		"data-surface",
		"general",
	);
	const review = shortcuts.locator('[data-testid="shortcuts-section"][data-surface="review"]');
	await expect(review).toHaveAttribute("data-current", "true");
	await expect(shortcuts.locator('[data-current="true"]')).toHaveCount(1);
	await expect(review).toBeInViewport();
	await expect(review.locator('[data-shortcut="review.comment"]')).toBeVisible();
	await expect(review.locator('[data-shortcut="review.sendNow"]')).toBeInViewport();
	await page.keyboard.press("Escape");
	await expect(shortcuts).toHaveCount(0);
	await expect(cursor).toBeFocused();
});

test("a rendered Markdown preview takes a block cursor and comments on whole blocks", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(
		join(worktree(), "BLOCKS.md"),
		"# Blocks\n\nFirst paragraph to review.\n\n- one item\n- two item\n",
	);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "BLOCKS.md" }).click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("First paragraph");
	await page.locator('[data-testid="editor-tab"][data-active="true"]').click();
	const cursor = cursorProxy(preview);
	await tabTo(page, cursor);
	await expectHonestSurface(preview);
	const cursorBlock = preview.locator("[data-review-block-cursor]");
	await expect(cursorBlock).toHaveText("Blocks");
	await expectCursorOption(preview, "Line 1: Blocks", 1, 4);

	await page.keyboard.press("j");
	await expect(cursorBlock).toHaveText("First paragraph to review.");
	await expectCursorOption(preview, "Line 3: First paragraph to review.", 2, 4);
	await page.keyboard.press("Shift+J");
	await expect(cursorBlock).toHaveText("one item");
	await expect(preview.locator("[data-review-block-range]")).toHaveCount(2);
	await expectCursorOption(preview, "Line 5: one item (selection: Lines 3–5)", 3, 4);
	await page.keyboard.press("Enter");
	const composer = page.getByTestId("review-composer");
	await expect(composer).toContainText("Lines 3–5");
	await page.keyboard.type("Tighten these.");
	await pressPlatformShortcut(page, "Enter");
	await expect(composer).toHaveCount(0);
	await expect(cursor).toBeFocused();
	await expect.poll(() => persistedComments().length).toBe(1);
	expect(lineRangeOf(persistedComments()[0])).toMatchObject({ startLine: 3, endLine: 5 });
});

test("a review jump in the single-file layout lands on the file header, so Enter never reverts it", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await commitAndModify(page, workspace.id, "cursor.ts", CURSOR_ORIGINAL, CURSOR_MODIFIED);
	writeFileSync(join(worktree(), "second.ts"), "export const second = 2;\n");
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "cursor.ts" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="changes"]')).toHaveCount(1);
	await page.getByTestId("changes-review-layout-single").click();
	const header = page.getByTestId("changes-section-header");
	await expect(header).toBeVisible();
	await page.locator('[data-testid="editor-tab"][data-active="true"]').click();

	await page.keyboard.press("j");
	await expect(header).toBeFocused();
	await expect(page.getByTestId("changes-section-revert")).not.toBeFocused();
	await page.keyboard.press("Enter");
	await page.keyboard.press(" ");
	await expect(page.getByText(/^Reverted /)).toHaveCount(0);

	const cursor = page.getByTestId("diff-view").getByTestId("review-cursor");
	await tabTo(page, cursor);
	await page.keyboard.press("Escape");
	await expect(header).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByText(/^Reverted /)).toHaveCount(0);
});

test("returning from a long Markdown draft brings the cursor block back into view", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}.`).join(
		"\n\n",
	);
	writeFileSync(join(worktree(), "LONG.md"), `# Long\n\n${paragraphs}\n`);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "LONG.md" }).click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("Paragraph 30.");
	await page.locator('[data-testid="editor-tab"][data-active="true"]').click();
	await tabTo(page, cursorProxy(preview));
	const heading = preview.getByRole("heading", { name: "Long" });
	await page.keyboard.press("Enter");
	await page.keyboard.type("Draft line");
	for (let line = 2; line <= 40; line += 1) {
		await page.keyboard.press("Shift+Enter");
		await page.keyboard.type(`Draft line ${line}`);
	}
	await pressPlatformShortcut(page, "Enter");
	await expect(cursorProxy(preview)).toBeFocused();
	const card = preview.getByTestId("review-thread-edit");
	await card.focus();
	await pressPlatformShortcut(page, "End");
	await expect(heading).not.toBeInViewport();
	await page.keyboard.press("Escape");
	await expect(cursorProxy(preview)).toBeFocused();
	await expect(heading).toBeInViewport();
});

test("the Markdown block cursor stays visible on a table row", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(
		join(worktree(), "TABLE.md"),
		"# Table\n\n| Name | Kind |\n| --- | --- |\n| Tree | renderer |\n| Table | renderer |\n",
	);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "TABLE.md" }).click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("renderer");
	await page.locator('[data-testid="editor-tab"][data-active="true"]').click();
	await tabTo(page, cursorProxy(preview));
	const cursorBlock = preview.locator("[data-review-block-cursor]");
	for (
		let press = 0;
		press < 6 && (await cursorBlock.evaluate((el) => el.tagName)) !== "TR";
		press += 1
	) {
		await page.keyboard.press("j");
	}
	await expect(cursorBlock).toHaveJSProperty("tagName", "TR");
	const background = await cursorBlock.evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(background).not.toBe("rgba(0, 0, 0, 0)");
});

test("an image takes a keyboard frame that comments on the same region a drag would", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(join(worktree(), "FRAME.png"), png(200, 100, [40, 120, 200]));
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "FRAME.png" }).dblclick();
	const surface = page.getByTestId("image-region-surface");
	await expect(surface).toBeVisible();
	const keys = surface.getByTestId("region-keys");
	await page.locator('[data-testid="editor-tab"][data-active="true"]').click();
	await tabTo(page, keys);

	await page.keyboard.press("Enter");
	const frame = surface.getByTestId("region-selection");
	await expect(frame).toBeVisible();
	await page.keyboard.press("l");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Shift+ArrowRight");
	await page.keyboard.press("Escape");
	await expect(frame).toHaveCount(0);
	await page.keyboard.press("Enter");
	await page.keyboard.press("l");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Shift+ArrowRight");
	await page.keyboard.press("Enter");
	const composer = page.getByTestId("review-composer");
	await expect(composer).toContainText("region");
	await page.keyboard.type("Look here.");
	await pressPlatformShortcut(page, "Enter");
	await expect(composer).toHaveCount(0);
	await expect(keys).toBeFocused();
	await expect.poll(() => persistedComments().length).toBe(1);
	const region = persistedComments()[0]?.anchor?.selectors.find(
		(selector) => selector.kind === "region",
	);
	expect(region?.x).toBeCloseTo(0.37, 5);
	expect(region?.y).toBeCloseTo(0.37, 5);
	expect(region?.width).toBeCloseTo(0.32, 5);
	expect(region?.height).toBeCloseTo(0.3, 5);
});

test("the swipe divider is a slider: arrows, h/l, Shift, PageUp/PageDown, Home/End", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await commitAndModify(
		page,
		workspace.id,
		"SWIPE.png",
		png(200, 100, [40, 120, 200]),
		png(200, 100, [200, 80, 40]),
	);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "SWIPE.png" }).dblclick();
	await page.getByTestId("image-diff-swipe").click();
	const divider = page.getByTestId("image-diff-divider");
	await expect(divider).toHaveAttribute("role", "slider");
	await expect(divider).toHaveAttribute("aria-valuenow", "50");
	await divider.focus();
	await page.keyboard.press("ArrowRight");
	await expect(divider).toHaveAttribute("aria-valuenow", "52");
	await page.keyboard.press("h");
	await page.keyboard.press("h");
	await expect(divider).toHaveAttribute("aria-valuenow", "48");
	await page.keyboard.press("Shift+ArrowRight");
	await expect(divider).toHaveAttribute("aria-valuenow", "58");
	await page.keyboard.press("PageDown");
	await expect(divider).toHaveAttribute("aria-valuenow", "48");
	await page.keyboard.press("End");
	await expect(divider).toHaveAttribute("aria-valuenow", "100");
	await page.keyboard.press("Home");
	await expect(divider).toHaveAttribute("aria-valuenow", "0");
	await page.keyboard.press("PageUp");
	await expect(divider).toHaveAttribute("aria-valuenow", "10");
});

test("Monaco comments on the caret line with Shift+Mod+M and no selection", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(join(worktree(), "caret.ts"), `${ORIGINAL.join("\n")}\n`);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "caret.ts" }).click();
	const editor = page.locator('[data-testid="editor-pane"]:visible .monaco-editor');
	await editor.getByText("const l3 = 3;").click();
	await pressPlatformShortcut(page, "Shift+M");
	const composer = page.getByTestId("review-composer");
	await expect(composer).toContainText("Line 3");
	await page.keyboard.type("Caret line.");
	await pressPlatformShortcut(page, "Enter");
	await expect(composer).toHaveCount(0);
	await expect.poll(() => persistedComments().length).toBe(1);
	expect(lineRangeOf(persistedComments()[0])).toMatchObject({ startLine: 3, endLine: 3 });
	await expect(editor.locator(":focus")).toHaveCount(1);
});
