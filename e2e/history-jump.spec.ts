import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { seedExternalCwdSessions, seedWorkspaceSession } from "./fixtures/sessions";

// Selecting a message hit in the Ctrl+R history overlay (A7) jumps to it: `useHistorySearch`'s
// `openMessage` sets the store's `chatLocationRequest`; `CenterTabs` opens/hydrates the target chat;
// `ChatView` scrolls to the matched row and flashes it (`[data-flash]`), then clears the request. This
// file drives that whole path against real, disk-only (never-opened) seeded sessions — the "come back to
// a workspace later and jump to something you remember" case the feature targets.
//
// `HistoryIndex` (packages/server/src/history/historyIndex.ts) is a process-wide singleton shared by the
// entire e2e run and throttles revalidation to `REVALIDATE_MS` (2s): once warm, a `history.search` call
// only rescans disk if it's been >2s since the *last* rescan anywhere in the process, otherwise it serves
// the previous scan's (possibly stale) results with no signal that they're stale. Every seed below is
// followed by an explicit `waitForTimeout(2_100)` before the first search this test fires, so the
// just-written file is guaranteed to be on disk long enough that the very next search is forced to
// rescan and pick it up — mirroring the unit-test workaround at `historyIndex.test.ts:173`.

test("selecting a same-workspace message hit opens the chat and flashes the matched row", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspaceA = await createWorkspaceViaDialog(page);

	seedWorkspaceSession(workspaceA.worktreePath, {
		id: "e2e-jump-same-ws",
		messages: [
			{ role: "user", text: "audit the retry backoff", timestamp: 1_700_100_000_000 },
			{
				role: "assistant",
				text: "Audited the retry backoff and added a jittered ceiling so it never spins forever.",
				timestamp: 1_700_100_001_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	// A reload doesn't auto-restore the active project/workspace (see `ask-restart.live.spec.ts`) — re-pick
	// both, so `CenterTabs`' hydrate-on-connect effect re-lists workspace A's sessions from a cold client,
	// the realistic "come back later" path. (Not load-bearing for the jump itself — case (c) below fetches
	// the target session directly by id regardless of whether `session.list` ever ran for it — but this
	// keeps the scenario honest to the brief and exercises the full reload path.)
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("project-item").first().click();
	await page.getByTestId("workspace-item").first().click();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	// A fresh chat (not the seeded one) so a composer exists; the seeded session stays unopened — jumping
	// to it must open a *second* tab, not reuse this one.
	await page.getByTestId("start-chat").click();
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.fill("jittered ceiling");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="message"]')
		.filter({ hasText: "jittered ceiling" });
	// Compact stage only lists prompts; the message hit lives behind the expand hint (no prompt matches
	// "jittered ceiling", so it's the sole match, but only visible once zoomed).
	await expect(page.getByTestId("history-expand-hint")).toBeVisible();
	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	await expect(hit).toBeVisible();
	// Zero prompts matched "jittered ceiling", so the flat list's only entry (index 0) is this message hit
	// — Enter selects it with no arrow-key navigation needed.
	await query.press("Enter");

	await expect(overlay).toBeHidden();
	// The seeded session opened as a second tab and is now active.
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	const flashRow = page.locator("[data-flash]");
	await expect(flashRow).toBeVisible();
	await expect(flashRow).toContainText("jittered ceiling");
});

test("selecting a cross-workspace message hit switches the active workspace and flashes the row", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspaceA = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspaceA.worktreePath, {
		id: "e2e-jump-cross-ws",
		messages: [
			{ role: "user", text: "review the changelog draft", timestamp: 1_700_200_000_000 },
			{
				role: "assistant",
				text: "Reviewed the changelog draft and tightened the wording on the migration notes.",
				timestamp: 1_700_200_001_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	// Workspace B: created second, so it's the active one — the search below runs from *its* chat, not A's.
	await createWorkspaceViaDialog(page);
	const workspaces = page.getByTestId("workspace-item");
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");
	await page.getByTestId("start-chat").click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	// Default scope is "workspace" (scoped to B, which has no history of its own) — cycle to "all"
	// (workspace → project → all, 2 presses) so workspace A's session is in scope.
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(page.getByTestId("history-scope")).toHaveAttribute("data-scope", "all");
	await query.fill("migration notes");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="message"]')
		.filter({ hasText: "migration notes" });
	await expect(page.getByTestId("history-expand-hint")).toBeVisible();
	await query.press("Tab");
	await expect(hit).toBeVisible();
	await query.press("Enter");

	await expect(overlay).toBeHidden();
	// Active workspace switched from B (index 1) to A (index 0).
	await expect(workspaces.nth(0)).toHaveAttribute("data-active", "true");
	await expect(workspaces.nth(1)).not.toHaveAttribute("data-active", "true");
	// Workspace A's tab strip now shows only the just-opened seeded chat (B's own started-but-empty chat is
	// a different workspace's tab list, hidden now that A is active).
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const flashRow = page.locator("[data-flash]");
	await expect(flashRow).toBeVisible();
	await expect(flashRow).toContainText("migration notes");
});

test("an unmapped message hit is a no-op — the overlay stays open and the active workspace is untouched", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page); // workspace A
	await createWorkspaceViaDialog(page); // workspace B — active
	// Deliberately-unmapped external-cwd fixture (see fixtures/sessions.ts): no project/workspace maps to
	// its cwd, so its message hits carry no `workspaceId`.
	seedExternalCwdSessions();
	await page.waitForTimeout(2_100);

	await page.getByTestId("start-chat").click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(page.getByTestId("history-scope")).toHaveAttribute("data-scope", "all");
	await query.fill("debounce window overlaps");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="message"]')
		.filter({ hasText: "debounce window overlaps" });
	await expect(page.getByTestId("history-expand-hint")).toBeVisible();
	await query.press("Tab");
	await expect(hit).toBeVisible();
	await expect(hit).toContainText("not a ThinkRail workspace");
	await query.press("Enter");

	// No-op: overlay stays open, no new tab, active workspace unchanged (still B).
	await expect(overlay).toBeVisible();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const workspaces = page.getByTestId("workspace-item");
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");
	await expect(workspaces.nth(0)).not.toHaveAttribute("data-active", "true");
});
