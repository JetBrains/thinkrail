import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

// Review mode without an agent: selection-triggered commenting (floating icon → inline composer), the
// self-announcing violet tab flag, the sidebar's grouping/count/statuses, in-place editing, the overall
// (review-level) note, and re-anchoring when the file changes under a comment.
// Sending drives a real pi session (provider tokens), so send/resolve round-trip coverage is deferred
// to a future @agent spec — the send handlers share the session.create/prompt path the @agent suite
// already exercises.

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");

/** The one VISIBLE comment icon (a diff keeps a hidden widget node per editor side). */
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

/** Select one line in the diff's worktree side: click into it, then Home + Shift+End. */
async function selectLine(page: Page, text: string): Promise<void> {
	await page.getByTestId("diff-pane").getByText(text).last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
}

/** The selection→icon→composer flow up to a filled composer. */
async function composeComment(page: Page, line: string, body: string): Promise<void> {
	await selectLine(page, line);
	await addIcon(page).click();
	await expect(page.getByTestId("review-composer")).toBeVisible();
	await page.getByTestId("review-composer-input").fill(body);
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

/**
 * Fire raw WS requests at the host from inside the page, in order, and return each result. Two uses
 * here: asserting what the host actually PERSISTED (rather than what the UI happens to render), and
 * driving the mutations the no-agent UI can't reach (a resolve needs a sent comment). Each call's
 * `workspaceId` is filled in with the active worktree workspace.
 *
 * The socket dials the PAGE's own origin (the host serves the UI, so it is the same origin under every
 * config) — hard-coding the dev suite's port silently pointed the binary suite at a dead port, where
 * the open never resolved and the evaluate hung to the test timeout.
 */
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
				results.push(await request(call.method, { workspaceId, ...call.params }));
			}
			ws.close();
			return results;
		},
		{ calls },
	);
}

/** The comments the HOST holds for the active workspace's open review. */
async function persistedComments(page: Page): Promise<PersistedComment[]> {
	const [snapshot] = await overWire(page, [{ method: "review.get", params: {} }]);
	return (snapshot as { comments: PersistedComment[] }).comments;
}

test("selection → icon → inline composer → draft; the tab wears the violet Review flag", async ({
	page,
}) => {
	await openDiff(page);

	// No selection — no icon; selecting a line pops it beside the selection.
	await expect(addIcon(page)).toHaveCount(0);
	await composeComment(page, "two = 2", "Rename `two` — unclear.");
	// The composer names its target and saves a draft.
	await expect(page.getByTestId("review-composer")).toContainText("Line 2");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	// The saved draft stays visible at its lines as an inline mini card (send on drafts — no delete:
	// a review comment is a record).
	const thread = page.getByTestId("review-thread");
	await expect(thread).toHaveCount(1);
	// A draft's body is the in-place editor (a textarea), so the text is its VALUE.
	await expect(thread.getByTestId("review-thread-edit")).toHaveValue("Rename `two` — unclear.");
	await expect(thread).toHaveAttribute("data-status", "draft");
	await expect(thread.locator('[data-testid="review-thread-send"]')).toBeVisible();

	// Review announces itself: violet flag on this file's tab + the pending badge, no mode was toggled —
	// and with drafts pending, the pane's toolbar carries the whole review's "Send review (N)" button.
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="diff"] [data-testid="review-tab-flag"]'),
	).toHaveAttribute("data-flag", "draft");
	await expect(page.getByTestId("send-review-button")).toHaveText(/Send review \(1\)/);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");

	// PER-FILE: a file without its own draft shows neither the flag nor the Send-review button, even
	// while the review has pending drafts elsewhere.
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(page.getByTestId("send-review-button")).toHaveCount(0);
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"] [data-testid="review-tab-flag"]'),
	).toHaveCount(0);
	// (Opening notes.txt replaced the preview diff tab — dev's single-preview-slot semantics — so
	// return to the commented file via Changes.)
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.getByTestId("send-review-button")).toBeVisible();

	// Esc closes the composer without saving.
	await composeComment(page, "one = 1", "never mind");
	await page.getByTestId("review-composer-input").press("Escape");
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");

	// The sidebar shows the draft; deleting it (a DRAFT-only action — sent comments are records with
	// no delete and no rollback) clears the flag: nothing unresolved remains.
	await page.getByTestId("tab-review").click();
	const rows = page.getByTestId("review-comment");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveAttribute("data-status", "draft");
	await rows.first().hover();
	await expect(page.getByTestId("review-comment-revert")).toHaveCount(0);
	await page.getByTestId("review-comment-delete").click();
	await expect(page.getByTestId("confirm-popover")).toBeVisible();
	await page.getByTestId("review-comment-delete-confirm").click();
	await expect(rows).toHaveCount(0);
	await expect(page.getByTestId("review-tab-flag")).toHaveCount(0);
	await expect(page.getByTestId("send-review-button")).toHaveCount(0);
	await expect(page.getByTestId("review-thread")).toHaveCount(0);
});

test("sidebar: per-file — auto-opens on a reviewed file, back arrow lists all files", async ({
	page,
}) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "First remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await composeComment(page, "three = 3", "Second remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	// Re-activating the reviewed file AUTO-opens the Review tab at the FILE level (its drafts).
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.getByTestId("tab-review")).toHaveAttribute("data-active", "true");
	const rows = page.getByTestId("review-comment");
	await expect(rows).toHaveCount(2);

	// Switching the CENTER tab to a non-reviewed one (same class as a send opening its chat tab) must
	// not kick the mounted panel back to the files list — it PINS to the file it was showing.
	await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.locator("button")
		.first()
		.click();
	await expect(page.getByTestId("review-back")).toBeVisible();
	await expect(rows).toHaveCount(2);
	// Return to the reviewed diff for the rest of the flow.
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();

	// No in-panel editing: rows are navigation. Clicking one opens the FILE focused on the comment.
	await expect(page.getByTestId("review-comment-edit-input")).toHaveCount(0);
	await page.getByTestId("review-comment-open").first().click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"]').getByText("script.ts"),
	).toBeVisible();

	// The back arrow goes to the FILES level: one row for script.ts with its counts; clicking the row
	// returns to the file's comments.
	await page.getByTestId("review-back").click();
	const fileRow = page.getByTestId("review-file-row").filter({ hasText: "script.ts" });
	await expect(fileRow).toBeVisible();
	await expect(fileRow).toContainText("2 drafts");
	await fileRow.click();
	await expect(rows).toHaveCount(2);

	await expect(page.getByTestId("review-pending-badge")).toHaveText("2");
	await expect(page.getByTestId("send-review-button")).toContainText("Send review (2)");
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

	// An edit ABOVE the fragment: the comment silently re-pins (moved), line number updates.
	writeFileSync(
		join(worktree(), "script.ts"),
		"// new header\nexport const one = 1;\nexport const two = 2;\nexport const three = 3;\n",
	);
	await expect(row).toHaveAttribute("data-anchor", "moved");
	await expect(row).toContainText("L3");

	// The fragment itself edited away: outdated — but the row keeps the creation-time snapshot.
	writeFileSync(
		join(worktree(), "script.ts"),
		"// new header\nexport const one = 1;\nexport const three = 3;\n",
	);
	await expect(row).toHaveAttribute("data-anchor", "outdated");
	// The creation-time snapshot survives server-side (see reviews unit tests); the row keeps the
	// last-known line ref + the comment text.
	await expect(row).toContainText("L3");
	await expect(row).toContainText("Rename `two`.");
});

test("preview mode: selecting rendered text comments on the mapped source lines", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	// A markdown file whose rendered text differs from source (bold markers) — the mapper's job.
	writeFileSync(
		join(worktree(), "NOTES.md"),
		"# Notes\n\nA paragraph with **important** words to review.\n\nAnother block entirely.\n",
	);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "NOTES.md" }).click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toContainText("important words");

	// Triple-click selects the rendered paragraph → the floating icon appears → inline composer.
	await preview.getByText("important words", { exact: false }).click({ clickCount: 3 });
	// It floats AT the selection: the measured rect reaches CSS as custom properties the stylesheet
	// consumes (no inline style object), and a broken seam would leave it pinned at the origin.
	await expect(addIcon(page)).not.toHaveCSS("top", "0px");
	await addIcon(page).click();
	const composer = page.getByTestId("review-composer");
	await expect(composer).toBeVisible();
	// Mapped back to the SOURCE line (line 3), despite the ** markers rendering strips.
	await expect(composer).toContainText("Line 3");
	await page.getByTestId("review-composer-input").fill("Tighten this paragraph.");
	await page.getByTestId("review-composer-save").click();
	await expect(composer).toHaveCount(0);

	// The saved comment sits IN the preview's flow — the card below its paragraph, the commented
	// block wearing the region mark (parity with Monaco's line decoration).
	const card = page.getByTestId("review-thread");
	await expect(card).toHaveCount(1);
	await expect(card).toContainText("Tighten this paragraph.");
	await expect(page.getByTestId("markdown-preview").locator(".review-region")).toHaveCount(1);

	// The draft is anchored like any Monaco-made comment: sidebar row carries L3 + the source fragment.
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");
	await page.getByTestId("tab-review").click();
	const row = page.getByTestId("review-comment");
	await expect(row).toHaveAttribute("data-status", "draft");
	await expect(row).toContainText("L3");
	await expect(row).toContainText("Tighten this paragraph.");
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

	// Comment from the SOURCE view on a line strictly INSIDE the fence — the preview can't reach such an
	// anchor (its stamped block is the whole `pre`), but Monaco and a re-anchor both can.
	await page.getByTestId("md-toggle-source").click();
	await page.getByTestId("editor-pane").getByText("const two = 2;").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await addIcon(page).click();
	await page.getByTestId("review-composer-input").fill("Second constant is unused.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	// Back in the preview the card splices in — after the whole code block, so the document is still the
	// same document. Cutting at the anchor left the fence unclosed: its first half rendered its own tail
	// as code and the leftover closing fence opened a SECOND block swallowing everything below.
	await page.getByTestId("md-toggle-preview").click();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview.getByTestId("review-thread")).toHaveCount(1);
	// ONE code block, stamped as the whole fence (`pre[data-md-line-*]` is the document's own — shiki
	// nests its highlighted `pre` inside it), holding both of its lines.
	const code = preview.locator("pre[data-md-line-start]");
	await expect(code).toHaveCount(1);
	await expect(code).toHaveAttribute("data-md-line-end", "6");
	await expect(code).toContainText("const one = 1;");
	await expect(code).toContainText("const two = 2;");
	// And the tail below the card is still prose, not the inside of a phantom code block.
	await expect(preview.locator("h2")).toHaveText("Prose after the fence");
	await expect(preview.locator("p").filter({ hasText: "A closing paragraph." })).toBeVisible();
});

test("a draft card edits in place; a sent comment can't be edited", async ({ page }) => {
	await openDiff(page);
	await composeComment(page, "two = 2", "First wording.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	// Click into the card body, rewrite, blur — the edit persists (visible in the sidebar too).
	const edit = page.getByTestId("review-thread-edit");
	await edit.click();
	await edit.fill("Better wording, typed right in the card.");
	await page.getByTestId("diff-pane").getByText("three = 3").last().click(); // blur
	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-comment")).toContainText(
		"Better wording, typed right in the card.",
	);

	// Esc reverts an in-progress edit instead of saving it.
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
	// README.md is committed on the base branch — edit it so the diff has BOTH sides.
	writeFileSync(join(worktree(), "README.md"), "# sample-project — renamed\n\nA new intro line.\n");
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await expect(page.getByTestId("diff-pane")).toContainText("renamed");
	// Markdown diff: switch to the Source (Monaco) view, where line commenting lives.
	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");

	// Select a line in the LEFT (original) editor — the icon appears there too.
	const original = page.locator(".editor.original");
	await original.getByText("sample-project").first().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await addIcon(page).click();
	await expect(page.getByTestId("review-composer")).toBeVisible();
	await page.getByTestId("review-composer-input").fill("Left-side remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	// The card renders in the ORIGINAL editor — the side the remark was made on — and nowhere else.
	await expect(page.locator(".editor.original").getByTestId("review-thread")).toHaveCount(1);
	await expect(page.locator(".editor.modified").getByTestId("review-thread")).toHaveCount(0);
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");

	// What's PERSISTED is a base anchor quoting the BASE's own line. Remapping it onto worktree lines
	// would have captured "# sample-project — renamed", i.e. the change the remark is questioning.
	const [comment] = await persistedComments(page);
	expect(comment?.anchor?.side).toBe("base");
	expect(comment?.anchor?.baseRef).toBeTruthy();
	expect(comment?.anchor?.selectors.find((s) => s.kind === "textQuote")?.exact).toBe(
		"# sample-project",
	);

	// And the sidebar navigates it back to that SAME surface. Leave the diff for another tab, then click
	// the row: a base remark must reopen the DIFF (the only view rendering the pre-change blob) — sending
	// it to the plain file tab would land on worktree lines that say something else, with no card.
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"notes.txt",
	);
	await page.getByTestId("tab-review").click();
	// The FILE row first (a file reviewed purely on its pre-change content), then the comment row.
	await page.getByTestId("review-file-row").filter({ hasText: "README.md" }).click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"][data-kind="diff"]'),
	).toContainText("README.md");
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	await page.getByTestId("tab-review").click();
	await page.getByTestId("review-file-row").filter({ hasText: "README.md" }).click();
	await page.getByTestId("review-comment-open").first().click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"][data-kind="diff"]'),
	).toContainText("README.md");
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

	// Resolve the second over the wire (the UI resolve lives on sent comments, which need an agent);
	// every client converges on the review.changed push.
	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-comment")).toHaveCount(2);
	const comments = await persistedComments(page);
	await overWire(page, [
		{
			method: "review.commentUpdate",
			params: { id: comments.find((c) => c.body.includes("resolved"))?.id, status: "resolved" },
		},
		{
			method: "review.commentUpdate",
			params: { id: comments.find((c) => c.body.includes("Open remark"))?.id, status: "sent" },
		},
	]);

	// A sent comment's glyph follows its session, TODO-style: no runtime loaded → waiting (paused).
	await expect(page.getByTestId("review-comment").locator('[data-glance="waiting"]')).toHaveCount(
		1,
	);
	// The row leaves the open list for the muted section; its in-file card disappears; the badge drops.
	const resolvedRow = page.getByTestId("review-comment-resolved");
	await expect(resolvedRow).toHaveCount(1);
	await expect(resolvedRow).toContainText("This one gets resolved.");
	await expect(page.getByTestId("review-comment")).toHaveCount(1);
	await expect(page.getByTestId("review-thread")).toHaveCount(1);
	// Both open comments left draft-hood (one sent, one resolved) — no pending badge.
	await expect(page.getByTestId("review-pending-badge")).toHaveCount(0);
	// The file is still IN REVIEW (a sent comment the chat is working on), so its tab keeps the flag —
	// muted, not violet — while "Send review" is gone: nothing is left to send.
	await expect(page.getByTestId("review-tab-flag")).toHaveAttribute("data-flag", "sent");
	await expect(page.getByTestId("send-review-button")).toHaveCount(0);

	// Resolved is final — no reopen affordance (like delete and rollback, undoing a review outcome
	// isn't offered); the linked chat stays reachable.
	await resolvedRow.hover();
	await expect(page.getByTestId("review-comment-reopen")).toHaveCount(0);

	// Resolve the last open comment too: the file STAYS listed ("2 resolved") until the user says
	// Done — then it leaves the review.
	await overWire(page, [
		{
			method: "review.commentUpdate",
			params: { id: comments.find((c) => c.body.includes("Open remark"))?.id, status: "resolved" },
		},
	]);
	await page.getByTestId("review-back").click();
	const fileRow = page.getByTestId("review-file-row").filter({ hasText: "script.ts" });
	await expect(fileRow).toContainText("2 resolved");
	// Done lives only in the opened file's header (a check glyph), not on the list row.
	await fileRow.hover();
	await expect(page.getByTestId("review-file-done")).toHaveCount(0);
	await fileRow.click();
	await page.getByTestId("review-file-done").click();
	await expect(page.getByTestId("review-file-row")).toHaveCount(0);
	await expect(page.getByTestId("review-empty")).toBeVisible();
});
