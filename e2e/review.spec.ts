import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");

const addIcon = (page: Page) => page.locator('[data-testid="review-add-icon"]:visible');

async function openDiff(page: Page): Promise<void> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(
		join(worktree(), "script.ts"),
		"export const one = 1;\nexport const two = 2;\nexport const three = 3;\n",
	);
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.getByTestId("diff-pane")).toContainText("three = 3");
}

async function openReviewClient(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("project-item").first().click();
	await worktreeRows(page).first().click();
	await page.getByTestId("tab-review").click();
	return page;
}

async function selectLine(page: Page, text: string): Promise<void> {
	await page.getByTestId("diff-pane").getByText(text).last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
}

async function composeComment(page: Page, line: string, body: string): Promise<void> {
	await selectLine(page, line);
	await addIcon(page).click();
	await expect(page.getByTestId("review-composer")).toBeVisible();
	await page.getByTestId("review-composer-input").fill(body);
}

function markSentOnDisk(commentId: string, sessionId = "sess-e2e"): void {
	const dir = join(E2E_DATA_DIR, "reviews");
	for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		const file = join(dir, name);
		const snapshot = JSON.parse(readFileSync(file, "utf8"));
		const comment = snapshot.comments.find((c: { id: string }) => c.id === commentId);
		if (!comment) continue;
		comment.status = "sent";
		comment.sentAt = Date.now();
		comment.sessionId = sessionId;
		snapshot.review.fileSessions = {
			...snapshot.review.fileSessions,
			[comment.anchor?.path ?? ""]: sessionId,
		};
		writeFileSync(file, `${JSON.stringify(snapshot, null, "\t")}\n`);
		return;
	}
	throw new Error(`No persisted review comment ${commentId} under ${dir}`);
}

function setReflectionOnDisk(
	commentId: string,
	reflection: { verdict: "kept" | "refuted"; confidence: string; reason: string },
): void {
	const dir = join(E2E_DATA_DIR, "reviews");
	for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		const file = join(dir, name);
		const snapshot = JSON.parse(readFileSync(file, "utf8"));
		const comment = snapshot.comments.find((c: { id: string }) => c.id === commentId);
		if (!comment) continue;
		comment.reflection = reflection;
		writeFileSync(file, `${JSON.stringify(snapshot, null, "\t")}\n`);
		return;
	}
	throw new Error(`No persisted review comment ${commentId} under ${dir}`);
}

interface PersistedComment {
	id: string;
	body: string;
	anchor: {
		path: string;
		side: string;
		baseRef?: string;
		selectors: { kind: string; exact?: string }[];
	} | null;
}

async function overWire(
	page: Page,
	calls: { method: string; params: Record<string, unknown> }[],
): Promise<unknown[]> {
	return page.evaluate(
		async ({ calls: pending }) => {
			const proto = location.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(`${proto}//${location.host}/ws`);
			await new Promise((r) => {
				ws.onopen = r;
			});
			const request = (method: string, params: unknown) =>
				new Promise<unknown>((resolve) => {
					const id = `t_${Math.random()}`;
					ws.addEventListener("message", (ev) => {
						const msg = JSON.parse(ev.data as string);
						if (msg.id === id) resolve(msg.result);
					});
					ws.send(JSON.stringify({ id, method, params }));
				});
			const projects = (await request("project.list", {})) as { id: string }[];
			const workspaces = (await request("workspace.list", { projectId: projects[0]?.id })) as {
				id: string;
				kind?: string;
			}[];
			const workspaceId = workspaces.find((w) => w.kind !== "default")?.id;
			const results: unknown[] = [];
			for (const call of pending) {
				results.push(await request(call.method, { workspaceId, id: workspaceId, ...call.params }));
			}
			ws.close();
			return results;
		},
		{ calls },
	);
}

async function persistedComments(page: Page): Promise<PersistedComment[]> {
	const [snapshot] = await overWire(page, [{ method: "review.get", params: {} }]);
	return (snapshot as { comments: PersistedComment[] }).comments;
}

test("selection → icon → inline composer → draft; the tab wears the violet Review flag", async ({
	page,
}) => {
	await openDiff(page);

	await expect(addIcon(page)).toHaveCount(0);
	await composeComment(page, "two = 2", "Rename `two` — unclear.");
	await expect(page.getByTestId("review-composer")).toContainText("Line 2");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	const thread = page.getByTestId("review-thread");
	await expect(thread).toHaveCount(1);
	await expect(thread.getByTestId("review-thread-edit")).toHaveValue("Rename `two` — unclear.");
	await expect(thread).toHaveAttribute("data-status", "draft");
	await expect(thread.locator('[data-testid="review-thread-send"]')).toBeVisible();

	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="diff"] [data-testid="review-tab-flag"]'),
	).toHaveAttribute("data-flag", "draft");
	await expect(page.getByTestId("send-review-button")).toHaveText(/Send review \(1\)/);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(page.getByTestId("send-review-button")).toHaveCount(0);
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"] [data-testid="review-tab-flag"]'),
	).toHaveCount(0);
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.getByTestId("send-review-button")).toBeVisible();

	await composeComment(page, "one = 1", "never mind");
	await page.getByTestId("review-composer-input").press("Escape");
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");

	await page.getByTestId("tab-review").click();
	const rows = page.getByTestId("review-comment");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveAttribute("data-status", "draft");
	await rows.first().hover();
	await expect(page.getByTestId("review-comment-revert")).toHaveCount(0);
	await page.getByTestId("review-comment-delete").click();
	await expect(page.getByTestId("confirm-popover")).toBeVisible();
	await page.mouse.move(0, 0);
	await expect
		.poll(() =>
			page.getByTestId("review-comment-delete").evaluate((node) => {
				const actions = node.closest('[class*="opacity-0"]');
				return actions ? getComputedStyle(actions).opacity : null;
			}),
		)
		.toBe("1");
	await page.getByTestId("review-comment-delete-confirm").click();
	await expect(rows).toHaveCount(0);
	await expect(page.getByTestId("review-tab-flag")).toHaveCount(0);
	await expect(page.getByTestId("send-review-button")).toHaveCount(0);
	await expect(page.getByTestId("review-thread")).toHaveCount(0);
});

test("a Monaco draft card keeps its mid-edit textarea across a sibling review push (zone reconcile)", async ({
	page,
}) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "First remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await composeComment(page, "three = 3", "Second remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await expect(page.getByTestId("review-thread")).toHaveCount(2);

	const firstEdit = page.getByTestId("review-thread-edit").nth(0);
	await expect(firstEdit).toHaveValue("First remark.");
	await firstEdit.click();
	await firstEdit.fill("First remark — work in progress, unsaved");
	await expect(firstEdit).toBeFocused();

	const second = (await persistedComments(page)).find((c) => c.body === "Second remark.");
	await overWire(page, [
		{
			method: "review.commentUpdate",
			params: { id: second?.id, body: "Second remark — edited elsewhere." },
		},
	]);
	await expect(page.getByTestId("review-thread-edit").nth(1)).toHaveValue(
		"Second remark — edited elsewhere.",
	);
	await expect(firstEdit).toHaveValue("First remark — work in progress, unsaved");
	await expect(firstEdit).toBeFocused();
});

test("sidebar: an accordion — the active reviewed file's section auto-unfolds; a row click folds/unfolds", async ({
	page,
}) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "First remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await composeComment(page, "three = 3", "Second remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"notes.txt",
	);
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"script.ts",
	);
	await expect(page.getByTestId("tab-review")).toHaveAttribute("data-active", "true");
	const section = page.locator('[data-testid="review-file-section"][data-path="script.ts"]');
	await expect(section).toHaveAttribute("data-expanded", "true");
	const rows = page.getByTestId("review-comment");
	await expect(rows).toHaveCount(2);
	await expect(section.getByTestId("review-file-row")).toContainText("2 drafts");

	await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.locator("button")
		.first()
		.click();
	await expect(section).toHaveAttribute("data-expanded", "true");
	await expect(rows).toHaveCount(2);
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"script.ts",
	);
	await expect(page.getByTestId("tab-review")).toHaveAttribute("data-active", "true");

	await expect(page.getByTestId("review-comment-edit-input")).toHaveCount(0);
	await page.getByTestId("review-comment-open").first().click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"]').getByText("script.ts"),
	).toBeVisible();

	const fileRow = section.getByTestId("review-file-row");
	await fileRow.click();
	await expect(section).toHaveAttribute("data-expanded", "false");
	await expect(rows).toHaveCount(0);
	await fileRow.click();
	await expect(section).toHaveAttribute("data-expanded", "true");
	await expect(rows).toHaveCount(2);

	await expect(page.getByTestId("review-pending-badge")).toHaveText("2");
	await expect(page.getByTestId("send-review-button")).toContainText("Send review (2)");
});

test("the editor context menu carries Comment on selection — the «+»'s twin, one composer", async ({
	page,
}) => {
	await openDiff(page);
	await selectLine(page, "two = 2");
	await expect(async () => {
		await page.getByTestId("diff-pane").getByText("two = 2").last().click({ button: "right" });
		const item = page.locator(".monaco-menu .action-menu-item", {
			hasText: "Comment on selection",
		});
		await expect(item).toBeVisible({ timeout: 2000 });
		await expect(item.locator(".editor-menu-icon svg")).toBeVisible({ timeout: 2000 });
		await expect(
			page
				.locator(".monaco-menu .action-menu-item", { hasText: "Copy" })
				.first()
				.locator(".editor-menu-icon svg"),
		).toBeVisible({ timeout: 2000 });
		await page.waitForTimeout(200);
		await item.click({ timeout: 1000 });
		await expect(page.getByTestId("review-composer")).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20_000 });
	const composer = page.getByTestId("review-composer");
	await expect(composer).toContainText("Line 2");
	await page.getByTestId("review-composer-input").fill("Via the context menu.");
	await page.getByTestId("review-composer-save").click();
	await expect(composer).toHaveCount(0);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");
});

test("the Review panel carries its own send buttons: per-file at the file level, Send all at the files level", async ({
	page,
}) => {
	await openDiff(page);
	for (const body of ["one", "two"]) {
		await composeComment(page, "two = 2", body);
		await page.getByTestId("review-composer-save").click();
		await expect(page.getByTestId("review-composer")).toHaveCount(0);
	}
	writeFileSync(join(worktree(), "notes.txt"), "a fresh remark target\nsecond line\n");
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "notes.txt" }).click();
	await composeComment(page, "fresh remark", "three");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	await page.getByTestId("tab-review").click();
	const notesSection = page.locator('[data-testid="review-file-section"][data-path="notes.txt"]');
	const scriptSection = page.locator('[data-testid="review-file-section"][data-path="script.ts"]');
	await expect(notesSection).toHaveAttribute("data-expanded", "true");
	await expect(notesSection.getByTestId("review-panel-send")).toContainText("Send review (1)");
	await expect(page.getByTestId("review-send-all")).toContainText("Send all (3)");

	await scriptSection.getByTestId("review-file-row").click();
	await expect(scriptSection.getByTestId("review-panel-send")).toContainText("Send review (2)");
	await expect(notesSection.getByTestId("review-panel-send")).toContainText("Send review (1)");
});

test("line-anchored comment re-anchors when the file changes (moved → outdated)", async ({
	page,
}) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "Rename `two`.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	await page.getByTestId("tab-review").click();
	const row = page.getByTestId("review-comment");
	await expect(row).toHaveAttribute("data-status", "draft");
	await expect(row).toHaveAttribute("data-anchor", "anchored");
	await expect(row).toContainText("L2");

	writeFileSync(
		join(worktree(), "script.ts"),
		"// new header\nexport const one = 1;\nexport const two = 2;\nexport const three = 3;\n",
	);
	await expect(row).toHaveAttribute("data-anchor", "moved");
	await expect(row).toContainText("L3");

	writeFileSync(
		join(worktree(), "script.ts"),
		"// new header\nexport const one = 1;\nexport const three = 3;\n",
	);
	await expect(row).toHaveAttribute("data-anchor", "outdated");
	await expect(row).toContainText("L3");
	await expect(row).toContainText("Rename `two`.");
});

test("preview mode: selecting rendered text comments on the mapped source lines", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(
		join(worktree(), "NOTES.md"),
		"# Notes\n\nA paragraph with **important** words to review.\n\nAnother block entirely.\n",
	);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "NOTES.md" }).click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("important words");

	await preview.getByText("important words", { exact: false }).click({ clickCount: 3 });
	await expect(addIcon(page)).not.toHaveCSS("top", "0px");
	await addIcon(page).click();
	const composer = page.getByTestId("review-composer");
	await expect(composer).toBeVisible();
	await expect(composer).toContainText("Line 3");
	await page.getByTestId("review-composer-input").fill("Tighten this paragraph.");
	await page.getByTestId("review-composer-save").click();
	await expect(composer).toHaveCount(0);

	const card = page.getByTestId("review-thread");
	await expect(card).toHaveCount(1);
	await expect(card).toContainText("Tighten this paragraph.");
	await expect(page.getByTestId("markdown-preview").locator(".review-region")).toHaveCount(1);

	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");
	await page.getByTestId("tab-review").click();
	const row = page.getByTestId("review-comment");
	await expect(row).toHaveAttribute("data-status", "draft");
	await expect(row).toContainText("L3");
	await expect(row).toContainText("Tighten this paragraph.");

	const [saved] = await persistedComments(page);
	await overWire(page, [
		{
			method: "review.commentUpdate",
			params: { id: saved?.id, body: "Reworded from the other client." },
		},
	]);
	await expect(page.getByTestId("review-thread-edit")).toHaveValue(
		"Reworded from the other client.",
	);
});

const zonesReserveCards = (page: Page) =>
	page.evaluate(() => {
		const cards = Array.from(
			document.querySelectorAll<HTMLElement>('[data-testid="review-thread"]'),
		).filter((card) => card.offsetHeight > 0);
		return (
			cards.length > 0 &&
			cards.every((card) => (card.parentElement?.offsetHeight ?? 0) + 2 >= card.offsetHeight)
		);
	});

test("cards drawn in the preview reserve their height in the source view — and back (no overlay)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const filler = Array.from({ length: 40 }, (_, i) => `Filler paragraph number ${i + 1}.\n`);
	writeFileSync(
		join(worktree(), "GUIDE.md"),
		[
			"# Guide\n",
			...filler,
			"First paragraph to review carefully.\n",
			"Second paragraph, right below the first.\n",
			"Trailing prose line one.",
			"Trailing prose line two.",
			"Trailing prose line three.",
		].join("\n"),
	);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "GUIDE.md" }).click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("Filler paragraph number 1.");

	for (const [text, body] of [
		["First paragraph", "123"],
		["Second paragraph", "456"],
	] as const) {
		await preview.getByText(text, { exact: false }).scrollIntoViewIfNeeded();
		await preview.getByText(text, { exact: false }).click({ clickCount: 3 });
		await addIcon(page).click();
		await page.getByTestId("review-composer-input").fill(body);
		await page.getByTestId("review-composer-save").click();
		await expect(page.getByTestId("review-composer")).toHaveCount(0);
	}
	await expect(preview.getByTestId("review-thread")).toHaveCount(2);

	await page.getByTestId("md-toggle-source").click();
	await scrollCardsIntoView(page);
	await expect.poll(() => zonesReserveCards(page), { timeout: 5000 }).toBe(true);

	await page.getByTestId("md-toggle-preview").click();
	await expect(page.getByTestId("markdown-preview").getByTestId("review-thread")).toHaveCount(2);
	await page.getByTestId("md-toggle-source").click();
	await scrollCardsIntoView(page);
	await expect.poll(() => zonesReserveCards(page), { timeout: 5000 }).toBe(true);
});

async function scrollCardsIntoView(page: Page): Promise<void> {
	const editor = page.locator(".monaco-editor").first();
	await expect(editor).toBeVisible();
	const box = await editor.boundingBox();
	if (!box) throw new Error("Monaco editor has no bounding box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (let i = 0; i < 30; i++) {
		await page.mouse.wheel(0, 800);
		await page.waitForTimeout(50);
		if (await page.getByTestId("review-thread").first().isVisible()) return;
	}
	throw new Error("No review card scrolled into view");
}

test("preview selection stays honest: a dragged piece stays a piece, and the composer's region mark is a rail, not a wash", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(
		join(worktree(), "BULLETS.md"),
		[
			"# Spec",
			"",
			"- **Owns:** the review store and its lifecycle, plus the anchoring helpers.",
			"- **Forbidden:** reaching into the agent module.",
			"",
			"Closing prose.",
			"",
		].join("\n"),
	);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "BULLETS.md" }).click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("Owns");
	await page.waitForTimeout(1200);

	const li = preview.locator("li").first();
	const box = await li.boundingBox();
	if (!box) throw new Error("bullet has no box");
	await page.mouse.move(box.x + 60, box.y + 11);
	await page.mouse.down();
	await page.mouse.move(box.x + 280, box.y + 11, { steps: 10 });
	await page.mouse.up();

	const state = await page.evaluate(() => {
		const sel = document.getSelection();
		const li = document.querySelector('[data-testid="markdown-preview"] li');
		const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
		return {
			text: sel?.toString() ?? "",
			insideBullet: !!(range && li?.contains(range.commonAncestorContainer)),
			bullet: li?.textContent ?? "",
		};
	});
	expect(state.text.length).toBeGreaterThan(3);
	expect(state.insideBullet).toBe(true);
	expect(state.bullet).toContain(state.text);
	expect(state.text.length).toBeLessThan(state.bullet.length);

	await addIcon(page).click();
	await expect(page.getByTestId("review-composer")).toBeVisible();
	const region = preview.locator(".review-region").first();
	await expect(region).toBeVisible();
	await expect(region).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("an in-flow card never halves a code fence — the rest of the document stays prose", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(
		join(worktree(), "FENCE.md"),
		[
			"# Fenced",
			"",
			"```ts",
			"const one = 1;",
			"const two = 2;",
			"```",
			"",
			"## Prose after the fence",
			"",
			"A closing paragraph.",
			"",
		].join("\n"),
	);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "FENCE.md" }).click();

	await page.getByTestId("md-toggle-source").click();
	await page.getByTestId("editor-pane").getByText("const two = 2;").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await addIcon(page).click();
	await page.getByTestId("review-composer-input").fill("Second constant is unused.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	await page.getByTestId("md-toggle-preview").click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview.getByTestId("review-thread")).toHaveCount(1);
	const code = preview.locator("pre[data-md-line-start]");
	await expect(code).toHaveCount(1);
	await expect(code).toHaveAttribute("data-md-line-end", "6");
	await expect(code).toContainText("const one = 1;");
	await expect(code).toContainText("const two = 2;");
	await expect(preview.locator("h2")).toHaveText("Prose after the fence");
	await expect(preview.locator("p").filter({ hasText: "A closing paragraph." })).toBeVisible();
});

test("a draft card edits in place; a sent comment can't be edited", async ({ page }) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "First wording.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	const edit = page.getByTestId("review-thread-edit");
	await edit.click();
	await edit.fill("Better wording, typed right in the card.");
	await page.getByTestId("diff-pane").getByText("three = 3").last().click();
	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-comment")).toContainText(
		"Better wording, typed right in the card.",
	);

	await edit.click();
	await edit.fill("Scratch that.");
	await edit.press("Escape");
	await expect(edit).toHaveValue("Better wording, typed right in the card.");
});

test("the diff's ORIGINAL (left) side is its own anchor space — base, never remapped", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	writeFileSync(join(worktree(), "README.md"), "# sample-project — renamed\n\nA new intro line.\n");
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await expect(page.getByTestId("diff-pane")).toContainText("renamed");
	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");

	const original = page.locator(".editor.original");
	await original.getByText("sample-project").first().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await addIcon(page).click();
	await expect(page.getByTestId("review-composer")).toBeVisible();
	await page.getByTestId("review-composer-input").fill("Left-side remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	await expect(page.locator(".editor.original").getByTestId("review-thread")).toHaveCount(1);
	await expect(page.locator(".editor.modified").getByTestId("review-thread")).toHaveCount(0);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");

	const [comment] = await persistedComments(page);
	expect(comment?.anchor?.side).toBe("base");
	expect(comment?.anchor?.baseRef).toBeTruthy();
	expect(comment?.anchor?.selectors.find((s) => s.kind === "textQuote")?.exact).toBe(
		"# sample-project",
	);

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"notes.txt",
	);
	await page.getByTestId("tab-review").click();
	const reviewSection = page
		.getByTestId("review-file-section")
		.filter({ has: page.getByTestId("review-file-row").filter({ hasText: "README.md" }) });
	const reviewFileRow = reviewSection.getByTestId("review-file-row");
	if ((await reviewSection.getAttribute("data-expanded")) === "true") {
		await reviewFileRow.click();
		await expect(reviewSection).toHaveAttribute("data-expanded", "false");
	}
	await reviewFileRow.click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"][data-kind="diff"]'),
	).toContainText("README.md");
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"notes.txt",
	);
	await page.getByTestId("tab-review").click();
	if ((await reviewSection.getAttribute("data-expanded")) !== "true") {
		await reviewSection.getByTestId("review-file-row").click();
	}
	await expect(reviewSection).toHaveAttribute("data-expanded", "true");
	await reviewSection.getByTestId("review-comment-open").first().click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"][data-kind="diff"]'),
	).toContainText("README.md");
	await expect(page.locator(".editor.original").getByTestId("review-thread")).toHaveCount(1);

	execSync(`git -C "${worktree()}" commit -am "land the rename"`, { stdio: "ignore" });
	await overWire(page, [{ method: "workspace.setDiffBase", params: { ref: "HEAD" } }]);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await page.getByTestId("tab-review").click();
	if ((await reviewSection.getAttribute("data-expanded")) !== "true") {
		await reviewSection.getByTestId("review-file-row").click();
	}
	await reviewSection.getByTestId("review-comment-open").first().click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"][data-kind="diff"]'),
	).toContainText("README.md");
	await expect(page.locator(".editor.original")).toContainText("# sample-project");
	await expect(page.locator(".editor.original")).not.toContainText("renamed");
	await expect(page.locator(".editor.original").getByTestId("review-thread")).toHaveCount(1);
});

test("resolved comments sink into a muted Resolved section (TODO Done style)", async ({ page }) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "Open remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await composeComment(page, "three = 3", "This one gets resolved.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-comment")).toHaveCount(2);
	const comments = await persistedComments(page);
	markSentOnDisk(comments.find((c) => c.body.includes("Open remark"))?.id ?? "");
	await overWire(page, [
		{
			method: "review.commentUpdate",
			params: { id: comments.find((c) => c.body.includes("resolved"))?.id, status: "resolved" },
		},
	]);

	await expect(page.getByTestId("review-comment").locator('[data-glance="waiting"]')).toHaveCount(
		1,
	);
	const resolvedRow = page.getByTestId("review-comment-resolved");
	await expect(resolvedRow).toHaveCount(1);
	await expect(resolvedRow).toContainText("This one gets resolved.");
	await expect(page.getByTestId("review-comment")).toHaveCount(1);
	await expect(page.getByTestId("review-thread")).toHaveCount(1);
	await expect(page.getByTestId("review-pending-badge")).toHaveCount(0);
	await expect(page.getByTestId("review-tab-flag")).toHaveAttribute("data-flag", "sent");
	await expect(page.getByTestId("send-review-button")).toHaveCount(0);
	await expect(page.getByTestId("review-panel-send")).toHaveCount(0);
	await expect(page.getByTestId("review-send-all")).toHaveCount(0);

	await resolvedRow.hover();
	await expect(page.getByTestId("review-comment-reopen")).toHaveCount(0);

	await overWire(page, [
		{
			method: "review.commentUpdate",
			params: { id: comments.find((c) => c.body.includes("Open remark"))?.id, status: "resolved" },
		},
	]);
	const fileRow = page.getByTestId("review-file-row").filter({ hasText: "script.ts" });
	await expect(fileRow).toContainText("2 resolved");
	await page.getByTestId("review-file-done").click();
	await expect(page.getByTestId("review-file-row")).toHaveCount(0);
	await expect(page.getByTestId("review-empty")).toBeVisible();
	await expect(page.getByTestId("review-clear")).toBeVisible();
	await expect(page.getByTestId("review-send-all")).toHaveCount(0);
});

test("Clear replaces the review for every connected client", async ({ page, browser }) => {
	await openDiff(page);
	await composeComment(page, "one = 1", "Discard this draft with the review.");
	await page.getByTestId("review-composer-save").click();
	await page.getByTestId("tab-review").click();

	const page2 = await openReviewClient(browser);
	await expect(page2.getByTestId("review-file-row")).toHaveCount(1);

	await page.getByTestId("review-clear").click();
	await expect(page.getByTestId("confirm-popover")).toContainText("Unsent drafts are discarded");
	await expect(page.getByTestId("review-file-row")).toHaveCount(1);
	await page.getByTestId("review-clear-confirm").click();

	await expect(page.getByTestId("review-empty")).toBeVisible();
	await expect(page2.getByTestId("review-empty")).toBeVisible();
	await expect(page.getByTestId("review-clear")).toHaveCount(0);
	await expect(page2.getByTestId("review-clear")).toHaveCount(0);
	await expect(persistedComments(page)).resolves.toEqual([]);
	await page2.context().close();
});

test("a draft is server truth: a second client converges by push, and a cold reload re-hydrates it", async ({
	page,
	browser,
}) => {
	await openDiff(page);
	await composeComment(page, "one = 1", "Persisted remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	const page2 = await openReviewClient(browser);
	await expect(page2.getByTestId("review-file-row")).toContainText("script.ts");
	await expect(page2.getByTestId("review-pending-badge")).toHaveText("1");
	await composeComment(page, "two = 2", "Second remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page2.getByTestId("review-pending-badge")).toHaveText("2");
	await page2.context().close();

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-pending-badge")).toHaveText("2");
	await expect(page.getByTestId("review-file-row")).toContainText("2 drafts");
});

test("Done is undone by a fresh remark: the file re-lists the moment a new comment lands", async ({
	page,
}) => {
	await openDiff(page);
	await composeComment(page, "one = 1", "The only remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	const comments = await persistedComments(page);
	await overWire(page, [
		{ method: "review.commentUpdate", params: { id: comments[0]?.id, status: "resolved" } },
	]);
	await page.getByTestId("tab-review").click();
	await page.getByTestId("review-file-done").click();
	await expect(page.getByTestId("review-empty")).toBeVisible();

	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await composeComment(page, "three = 3", "One more thing.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");
	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-file-row")).toContainText("script.ts");
	await expect(page.getByTestId("review-file-row")).toContainText("1 draft");
});

test("a finding refuted by reflection wears the 'refuted by reflection' badge", async ({
	page,
	browser,
}) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "BUG: `two` is wrong.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	const [comment] = await persistedComments(page);
	if (!comment) throw new Error("expected a persisted draft comment");
	setReflectionOnDisk(comment.id, {
		verdict: "refuted",
		confidence: "high",
		reason: "`two` is fine as named",
	});

	// A fresh client re-fetches the snapshot (review.get) — the refuted verdict rides it to the panel.
	const client = await openReviewClient(browser);
	const section = client.locator('[data-testid="review-file-section"][data-path="script.ts"]');
	await expect(section.getByTestId("review-file-row")).toBeVisible();
	if ((await section.getAttribute("data-expanded")) !== "true")
		await section.getByTestId("review-file-row").click();
	const badge = client.getByTestId("review-comment-refuted");
	await expect(badge).toBeVisible();
	await expect(badge).toHaveText("refuted by reflection");
	await client.context().close();
});
