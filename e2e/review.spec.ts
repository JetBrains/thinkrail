import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
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

/** Open a second browser client on this suite's managed workspace, with its Review panel visible. */
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

/**
 * Mark a persisted comment SENT the way the send path (`markCommentsSent`) would — status, `sentAt`,
 * the session link, and the file's `fileSessions` pin. The wire deliberately can't un-draft or
 * "send" a comment (`review.commentUpdate` lands only resolved/dismissed), so the no-agent suite
 * reaches sent-hood by editing the review file on disk; the host reads it fresh per mutation, so the
 * next wire call's `review.changed` push carries this state to every client.
 */
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
				// Injected under BOTH param names the handlers use (`workspaceId` for review.*, `id` for
				// workspace.*); explicit params win via spread order (e.g. commentUpdate's own `id`).
				results.push(await request(call.method, { workspaceId, id: workspaceId, ...call.params }));
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

test("a Monaco draft card keeps its mid-edit textarea across a sibling review push (zone reconcile)", async ({
	page,
}) => {
	await openDiff(page);
	// Two drafts on different lines — sorted by line, so nth(0) is L2, nth(1) is L3.
	await composeComment(page, "two = 2", "First remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await composeComment(page, "three = 3", "Second remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);
	await expect(page.getByTestId("review-thread")).toHaveCount(2);

	// Start editing the FIRST draft's body but DON'T blur/save — an unsaved local edit living only in
	// the textarea (its persisted body is still "First remark.").
	const firstEdit = page.getByTestId("review-thread-edit").nth(0);
	await expect(firstEdit).toHaveValue("First remark.");
	await firstEdit.click();
	await firstEdit.fill("First remark — work in progress, unsaved");
	await expect(firstEdit).toBeFocused();

	// Another client edits the OTHER comment — a `review.changed` push that re-runs `setThreads`. Before
	// the zone reconcile this tore every view zone (and this textarea) down and rebuilt it from the
	// persisted body, silently dropping the in-flight edit.
	const second = (await persistedComments(page)).find((c) => c.body === "Second remark.");
	await overWire(page, [
		{
			method: "review.commentUpdate",
			params: { id: second?.id, body: "Second remark — edited elsewhere." },
		},
	]);
	// The push landed (the second card rebuilt with the new body)…
	await expect(page.getByTestId("review-thread-edit").nth(1)).toHaveValue(
		"Second remark — edited elsewhere.",
	);
	// …and the first card — unchanged in the snapshot — kept its exact DOM: the unsaved edit, and focus.
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

	// Re-activating the reviewed file AUTO-opens the Review tab with the file's section unfolded.
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

	// Switching the CENTER tab to a non-reviewed one (same class as a send opening its chat tab)
	// collapses nothing — folding is the user's gesture alone.
	await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.locator("button")
		.first()
		.click();
	await expect(section).toHaveAttribute("data-expanded", "true");
	await expect(rows).toHaveCount(2);
	// Return to the reviewed diff for the rest of the flow.
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"script.ts",
	);
	await expect(page.getByTestId("tab-review")).toHaveAttribute("data-active", "true");

	// No in-panel editing: rows are navigation. Clicking one opens the FILE focused on the comment.
	await expect(page.getByTestId("review-comment-edit-input")).toHaveCount(0);
	await page.getByTestId("review-comment-open").first().click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"]').getByText("script.ts"),
	).toBeVisible();

	// A row click FOLDS the open section (no navigation); a second click unfolds it again.
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
	// Right-click INSIDE the selection keeps it; Monaco's own menu opens with our action after Copy.
	// The whole gesture retries as one block: Monaco arms the menu's mouseup listener only ~100ms
	// after it opens ("avoid accidental clicks" — menu.js's RunOnceScheduler), and a live diff
	// re-read can remount the editor under the open menu — either way the next attempt starts clean.
	await expect(async () => {
		await page.getByTestId("diff-pane").getByText("two = 2").last().click({ button: "right" });
		const item = page.locator(".monaco-menu .action-menu-item", {
			hasText: "Comment on selection",
		});
		await expect(item).toBeVisible({ timeout: 2000 });
		// The rows wear our lucide icons (monacoMenuIcons decorates the menu right after it opens).
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
	// Same composer as the «+» path — saving lands the same draft.
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
	// A second reviewed file, so Send all spans files while Send review stays per-file.
	writeFileSync(join(worktree(), "notes.txt"), "a fresh remark target\nsecond line\n");
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "notes.txt" }).click();
	await composeComment(page, "fresh remark", "three");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-composer")).toHaveCount(0);

	// The active tab is notes.txt — its section auto-unfolds with the pane toolbar's button in its
	// strip, counting exactly THIS file's drafts; the panel header's Send all spans every file.
	await page.getByTestId("tab-review").click();
	const notesSection = page.locator('[data-testid="review-file-section"][data-path="notes.txt"]');
	const scriptSection = page.locator('[data-testid="review-file-section"][data-path="script.ts"]');
	await expect(notesSection).toHaveAttribute("data-expanded", "true");
	await expect(notesSection.getByTestId("review-panel-send")).toContainText("Send review (1)");
	await expect(page.getByTestId("review-send-all")).toContainText("Send all (3)");

	// Unfolding the other file's section shows ITS two — never the neighbor's.
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

	// Another client's body edit converges into the OPEN preview card's editor (the `review.changed`
	// push reconciles a non-dirty field — the card must not pin its mount-time text forever).
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

/** In the SOURCE view a thread card lives in a Monaco view zone; the zone (the card's parent node,
 * sized by Monaco to `heightInPx`) must reserve at least the card's real height — anything less and
 * the card paints OVER the following lines. */
const zonesReserveCards = (page: Page) =>
	page.evaluate(() => {
		// Only cards with real geometry count — Monaco keeps an off-viewport zone's node at display:none
		// (0-high card), which is fine as long as at least one card is measurable and none overflows.
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
	// Long enough that the LAST paragraphs sit far below the source view's initial viewport — Monaco
	// keeps an off-screen view zone's node at display:none, so a card down there measures 0 until it
	// scrolls in. A one-shot measure at mount left such zones at their placeholder height forever, and
	// the cards painted OVER the following lines once the user scrolled to them.
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

	// Two drafts made in the RENDERED view — close together, like a real review pass.
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

	// Switch to SOURCE: the drafts render as view-zone cards under their anchor lines, below the fold.
	// Scroll them in — each zone must have grown to its card's real height by the time it shows.
	await page.getByTestId("md-toggle-source").click();
	await scrollCardsIntoView(page);
	await expect.poll(() => zonesReserveCards(page), { timeout: 5000 }).toBe(true);

	// … and back, and again: the round trip must not degrade either surface.
	await page.getByTestId("md-toggle-preview").click();
	await expect(page.getByTestId("markdown-preview").getByTestId("review-thread")).toHaveCount(2);
	await page.getByTestId("md-toggle-source").click();
	await scrollCardsIntoView(page);
	await expect.poll(() => zonesReserveCards(page), { timeout: 5000 }).toBe(true);
});

/** Wheel-scroll the source view's Monaco editor down until a review card is on screen (they live
 * near the bottom of the fixture; zone growth can shift the bottom, so scroll → check, repeatedly). */
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
	// Let the open-time fs tick settle — a live re-read remounting the document mid-drag is a
	// different (inherent) event; this test pins that the SELECTION itself causes no remount.
	await page.waitForTimeout(1200);

	// Drag across a few words INSIDE the first bullet. The icon-follows-selection machinery must not
	// touch React state mid-drag: a re-render swaps the text nodes under the live selection and
	// Chrome "restores" it by flooding whole blocks (a few words painted the entire bullet).
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
			// The selection must stay INSIDE the bullet — never span out into neighboring blocks.
			insideBullet: !!(range && li?.contains(range.commonAncestorContainer)),
			bullet: li?.textContent ?? "",
		};
	});
	expect(state.text.length).toBeGreaterThan(3);
	expect(state.insideBullet).toBe(true);
	expect(state.bullet).toContain(state.text); // a piece of the bullet — not the whole document
	expect(state.text.length).toBeLessThan(state.bullet.length); // …and strictly a piece

	// Open the composer: the target block wears the region RAIL — never a background wash, which
	// painted the whole bullet wall-to-wall and read as "my selection flooded everywhere".
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
	const reviewSection = page
		.getByTestId("review-file-section")
		.filter({ has: page.getByTestId("review-file-row").filter({ hasText: "README.md" }) });
	const reviewFileRow = reviewSection.getByTestId("review-file-row");
	// Side groups are independent, so Review may have stayed mounted and unfolded while All files was used.
	// Fold first when necessary; the following unfold is the FILE-row navigation under test.
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
	// The panel follows an already-active reviewed surface by unfolding its row; otherwise unfold it here.
	// Either path must expose the comment navigation without accidentally toggling an open row closed.
	if ((await reviewSection.getAttribute("data-expanded")) !== "true") {
		await reviewSection.getByTestId("review-file-row").click();
	}
	await expect(reviewSection).toHaveAttribute("data-expanded", "true");
	await reviewSection.getByTestId("review-comment-open").first().click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"][data-kind="diff"]'),
	).toContainText("README.md");
	await expect(page.locator(".editor.original").getByTestId("review-thread")).toHaveCount(1);

	// The reopened surface is PINNED to the anchor's own baseRef: land the rename as a commit and
	// re-point the review target to HEAD — a branch scope's original side now resolves to the
	// workspace's own tip, where no "# sample-project" line exists — and navigation must still show
	// the very blob the remark quotes, card mounted on it.
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
	// The pinned original is the PRE-rename blob: the rename exists only on the modified side. (A
	// substring check alone is too weak — "# sample-project — renamed" contains "# sample-project".)
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

	// Mark the first SENT on disk (the wire can't — draft↔sent belongs to the send path), then resolve
	// the second over the wire; that mutation's review.changed push carries BOTH states, and every
	// client converges on the push.
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
	// …and the panel's own send affordances share the drafts-only gate: nothing sendable, no buttons.
	await expect(page.getByTestId("review-panel-send")).toHaveCount(0);
	await expect(page.getByTestId("review-send-all")).toHaveCount(0);

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
	const fileRow = page.getByTestId("review-file-row").filter({ hasText: "script.ts" });
	await expect(fileRow).toContainText("2 resolved");
	// Everything resolved surfaces the Done finisher INLINE in the row (after the counts) —
	// finishing empties the accordion.
	await page.getByTestId("review-file-done").click();
	await expect(page.getByTestId("review-file-row")).toHaveCount(0);
	await expect(page.getByTestId("review-empty")).toBeVisible();
	// …but the resolved records live on, so Clear stays available to archive them and start fresh —
	// the header follows records, not file rows (Send all is gone: nothing draftable).
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

	// A SECOND client on the same workspace: the existing draft hydrates, and a draft added by client 1
	// AFTERWARDS arrives by `review.changed` push — no reload, no optimism, both screens agree.
	const page2 = await openReviewClient(browser);
	await expect(page2.getByTestId("review-file-row")).toContainText("script.ts");
	await expect(page2.getByTestId("review-pending-badge")).toHaveText("1");
	await composeComment(page, "two = 2", "Second remark.");
	await page.getByTestId("review-composer-save").click();
	await expect(page2.getByTestId("review-pending-badge")).toHaveText("2");
	await page2.context().close();

	// A cold reload of client 1: the fragment restores the workspace, and the review hydrates back whole.
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
	// Resolve it over the wire (the UI resolve needs an agent-sent comment), then finish the file.
	const comments = await persistedComments(page);
	await overWire(page, [
		{ method: "review.commentUpdate", params: { id: comments[0]?.id, status: "resolved" } },
	]);
	await page.getByTestId("tab-review").click();
	// All resolved → the row wears the Done finisher inline, no unfolding needed.
	await page.getByTestId("review-file-done").click();
	await expect(page.getByTestId("review-empty")).toBeVisible();

	// A fresh remark on the SAME file re-opens its review — Done is a state, not a tombstone.
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await composeComment(page, "three = 3", "One more thing.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("review-pending-badge")).toHaveText("1");
	await page.getByTestId("tab-review").click();
	await expect(page.getByTestId("review-file-row")).toContainText("script.ts");
	await expect(page.getByTestId("review-file-row")).toContainText("1 draft");
});
