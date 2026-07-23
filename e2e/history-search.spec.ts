import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, openWorkspaceChat } from "./fixtures/app";
import { seedExternalCwdSessions, seedWorkspaceSession } from "./fixtures/sessions";

// No-agent (see composer.live.spec.ts for the @agent-tagged composer suite): the Ctrl+R history-recall
// overlay never touches the agent — `openWorkspaceChat` creates a chat session but sends nothing to it.
// `history.search` runs against the two deterministic sessions `seedExternalCwdSessions` seeds for the
// deliberately unmapped `E2E_EXTERNAL_CWD` (see fixtures/sessions.ts): "deploy the docs site" / "fix the
// flaky watcher test" (+ an assistant reply containing "the debounce window overlaps") and, in a second
// session, "update dependency pins".
//
// Deviation from the brief's literal wording: Step 2 describes querying "flaky" and expecting BOTH a
// prompt hit ("fix the flaky watcher test") and a message hit ("...debounce window overlaps...") to
// surface for the same query. That pair isn't reachable — `historyIndex.ts`'s `matchesTerms` matches each
// transcript entry independently, and "flaky" only appears in the user prompt, never in the assistant
// reply. Querying "fix" instead matches both entries (a direct substring of the prompt, and a
// case-insensitive substring of "Fixed" in the reply) and otherwise exercises the exact same scenario the
// brief describes — see task-A7-report.md for the full writeup.

test("Ctrl+R opens history recall, cycles scope to all, zooms to messages, inserts a prompt, and Esc preserves the draft", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	// `openWorkspaceChat` → `openAppFresh` → `resetState()` unconditionally wipes `E2E_PI_AGENT_DIR/sessions`
	// (see its jsdoc: stale sessions must be cleared so they don't resurface in a reused worktree) — which
	// also empties the external-cwd fixture `globalSetup` seeded once for the whole run. Re-seed per-test,
	// the same way `seedWorkspaceSession`'s own doc comment describes doing "during a test"; the write is
	// idempotent (same ids/timestamps every call), so re-seeding here never duplicates or drifts the fixture.
	seedExternalCwdSessions();

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");
	const promptItems = page.locator('[data-testid="history-item"][data-kind="prompt"]');
	const messageItems = page.locator('[data-testid="history-item"][data-kind="message"]');

	// Ctrl+R from the composer opens the overlay in `compact` stage, focused on the (seeded-empty) query,
	// defaulted to `workspace` scope.
	await input.press("Control+r");
	await expect(overlay).toBeVisible();
	await expect(overlay).toHaveAttribute("data-stage", "compact");
	await expect(query).toBeFocused();
	await expect(scopeBadge).toHaveAttribute("data-scope", "workspace");

	// Query "fix" (see file-header deviation note), then cycle scope workspace → project → all (2 presses)
	// so the deliberately-unmapped external-cwd fixture sessions are in scope.
	await query.fill("fix");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "all");
	await expect(scopeBadge).toContainText("All");
	await expect(promptItems.filter({ hasText: "fix the flaky watcher test" })).toBeVisible();
	// Exactly one prompt matches "fix" across the seeded fixtures — the Prompts counter is "shown/total".
	await expect(page.getByTestId("history-counts")).toHaveText("1/1");

	// Tab zooms to `zoomed` (both sections); the assistant reply surfaces as a message hit, flagged as not
	// belonging to a ThinkRail workspace (the fixture's cwd is deliberately unmapped — see the file header).
	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	const debounceHit = messageItems.filter({ hasText: "debounce window overlaps" });
	await expect(debounceHit).toBeVisible();
	await expect(debounceHit).toContainText("not a ThinkRail workspace");
	// messages is assistant-only — "fix the flaky watcher test" (user-role) no longer reappears as a
	// message (its jump anchor lives on the prompt hit above instead); only the assistant reply
	// matches "fix" (via "Fixed"). The Messages counter is the second `history-counts` (Prompts renders
	// first).
	await expect(page.getByTestId("history-counts").last()).toHaveText("1/1");

	// ↓ moves the flat-list selection off the prompt and onto that (unmapped) message hit; Enter on an
	// unmapped message hit is a deliberate no-op — the overlay stays open and the draft is untouched.
	await query.press("ArrowDown");
	await query.press("Enter");
	await expect(overlay).toBeVisible();
	await expect(input).toHaveValue("");

	// ↑ moves the selection back onto the prompt hit. Enter now inserts it into the composer, focuses it,
	// and closes the overlay.
	await query.press("ArrowUp");
	await query.press("Enter");
	await expect(overlay).toBeHidden();
	await expect(input).toHaveValue("fix the flaky watcher test");
	await expect(input).toBeFocused();

	// Draft preservation: a fresh draft survives Ctrl+R → mutating the query → Esc leaves it untouched.
	await input.fill("my draft");
	await input.press("Control+r");
	await expect(overlay).toBeVisible();
	await expect(query).toHaveValue("my draft");
	await query.fill("nothing matches this");
	await query.press("Escape");
	await expect(overlay).toBeHidden();
	await expect(input).toHaveValue("my draft");

	// Cmd/Ctrl+Enter on a selected prompt hit inserts AND submits, reusing the composer's own send path —
	// cheap to cover with no agent: `onSubmit` appends the user message optimistically *before* the (here,
	// rejected — no auth in this suite) transport call, so the sent text lands in the transcript regardless
	// of what the host does next. Re-open + re-navigate to the same prompt hit rather than reusing the
	// overlay instance closed by the Enter-insert above. `ControlOrMeta` is Playwright's cross-platform
	// modifier alias (Meta on macOS, Control elsewhere) — it matches the app's own check on both the
	// Composer's and the overlay's key handlers (`e.metaKey || e.ctrlKey`), so this exercises the same
	// gesture a real user would make on either platform.
	await input.press("Control+r");
	await query.fill("fix");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "all");
	await expect(promptItems.filter({ hasText: "fix the flaky watcher test" })).toBeVisible();
	await query.press("ControlOrMeta+Enter");
	await expect(overlay).toBeHidden();
	await expect(input).toHaveValue("");
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "fix the flaky watcher test" }),
	).toBeVisible();
});

test("empty query in chat scope shows the empty state for a session with no history yet", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");

	await input.press("Control+r");
	await expect(overlay).toBeVisible();

	// `openOverlay` always resets scope to `workspace`; reaching `chat` takes 3 forward cycles:
	// workspace → project → all → chat.
	await query.press("Control+r");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "chat");

	// This chat session was just created and never sent to — no prompts/messages of its own, so an empty
	// query (which otherwise matches everything) still turns up nothing.
	await expect(overlay).toContainText("no matches");
});

test("Ctrl+R dismisses an open mention menu instead of overlapping it", async ({ page }) => {
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const mentionMenu = page.getByTestId("mention-menu");

	// `@` alone matches every root-level entry (`fs.readDir` with an empty prefix) — the fixture repo
	// always has files at its root, so the mention menu is guaranteed to have candidates to show.
	await input.fill("@");
	await expect(mentionMenu).toBeVisible();

	// Regression: both floating panels anchor at the same `bottom-full` rect above the composer, so Ctrl+R
	// must dismiss the mention menu rather than paint the history overlay on top of it
	// (`Composer.tsx`'s Ctrl+R guard calls `setDismissed(true)` before `onHistoryOpen()`).
	await input.press("Control+r");
	await expect(overlay).toBeVisible();
	await expect(mentionMenu).not.toBeVisible();
});

// A9: plain `↑`/`↓` recall (no Ctrl+R, no query typing) steps through *this chat's own* prior prompts — it
// needs a chat whose runtime actually has prior user turns, so `openWorkspaceChat`'s brand-new session
// (never sent to) doesn't do; seed one via `seedWorkspaceSession` on a real workspace `worktreePath` (see
// the comment at its first use in `history-jump.spec.ts` for why that path, not some arbitrary string, is
// the seed target) and open it. Simplest way in: the `chat-history` / `closed-chat-item` reopen flow
// (`CenterTabs.tsx`) rather than the search-and-jump flow `history-jump.spec.ts` already covers — a
// disk-only session surfaces there the moment its workspace becomes active. No `historyIndex` revalidation
// wait is needed here (contrast the 2.1s waits in `history-jump.spec.ts`): `session.list` reads pi's
// `SessionManager.list` straight off disk on every call, it isn't behind the throttled `HistoryIndex`
// singleton that backs `history.search`.
test("plain ArrowUp/ArrowDown recall steps through this chat's own prior prompts, a diverging edit exits the session, and the history button opens the overlay", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	// No explicit `id`: this test never references the seeded session by id again (it reopens via the
	// `chat-history` → `closed-chat-item` UI flow below), so the default fresh-per-call id is enough —
	// and, unlike a fixed literal id, survives a Playwright retry within the same `webServer` lifetime.
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{ role: "user", text: "audit the retry backoff", timestamp: 1_700_400_000_000 },
			{ role: "assistant", text: "Audited it — looks fine.", timestamp: 1_700_400_001_000 },
			{
				role: "user",
				text: "add a jittered ceiling to the backoff",
				timestamp: 1_700_400_002_000,
			},
			{ role: "assistant", text: "Added the ceiling.", timestamp: 1_700_400_003_000 },
			{ role: "user", text: "write a test for the jitter", timestamp: 1_700_400_004_000 },
			{ role: "assistant", text: "Added a test.", timestamp: 1_700_400_005_000 },
		],
	});

	// A reload doesn't auto-restore the active project/workspace (see `history-jump.spec.ts`) — re-pick both
	// so `CenterTabs`'s hydrate-on-connect effect re-lists this workspace's sessions from a cold client and
	// discovers the disk-only seeded one.
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("project-item").first().click();
	await page.getByTestId("workspace-item").first().click();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-item").first().click();
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();
	// The reopened chat's transcript is restored, but its *draft* is fresh — recall must start from empty.
	await expect(input).toHaveValue("");

	// Newest first: ArrowUp on the empty field recalls the latest prompt, then steps older.
	await input.press("ArrowUp");
	await expect(input).toHaveValue("write a test for the jitter");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("add a jittered ceiling to the backoff");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("audit the retry backoff");
	// Clamped at the oldest entry — one more ArrowUp doesn't wrap around.
	await input.press("ArrowUp");
	await expect(input).toHaveValue("audit the retry backoff");

	// ArrowDown steps back newer; past the newest restores the empty draft.
	await input.press("ArrowDown");
	await expect(input).toHaveValue("add a jittered ceiling to the backoff");
	await input.press("ArrowDown");
	await expect(input).toHaveValue("write a test for the jitter");
	await input.press("ArrowDown");
	await expect(input).toHaveValue("");

	// A diverging edit (the composer's own `fill`, exactly like a real keystroke — Playwright's `fill`
	// dispatches a native `input` event React's controlled `onChange` reacts to) exits the recall session:
	// the next ArrowUp must not step — the value is unchanged besides the edit itself.
	await input.press("ArrowUp");
	await expect(input).toHaveValue("write a test for the jitter");
	await input.fill("write a test for the jitter!");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("write a test for the jitter!");

	// The history button — the tap path on mobile, a discoverability affordance on desktop — opens the
	// exact same overlay `Ctrl+R` does.
	await page.getByTestId("history-open").click();
	await expect(page.getByTestId("history-overlay")).toBeVisible();
});

// Regression for a real flake caught in the test above: `Composer`'s `focusCaret` used to move the caret
// via a bare `requestAnimationFrame`, which only guarantees "before the next paint" — leaving a gap after
// the triggering keystroke's task ends where another actor touching the same textarea's selection (e.g.
// Playwright's `fill`, which does select-all then insert-text as separate steps) could run first. If that
// stale RAF fired between `fill`'s select-all and insert steps, its `setSelectionRange(pos, pos)` collapsed
// the select-all to a bare caret, so the insert appended instead of replacing — producing a doubled
// `oldValue + newValue` (seen as `"write a test for the jitterwrite a test for the jitter!"` under
// parallel-worker contention). `focusCaret` now moves the caret from a `useLayoutEffect`, which commits
// synchronously in the same task as the triggering keystroke — there's no longer a gap for `fill` (or any
// other follow-up interaction) to land in. This mechanism doesn't depend on Playwright specifically — any
// fast selection-replacing interaction right after a recall step could have raced the old stale RAF — so
// this is a real feature fix, not test-only synchronization; CPU-throttling below only makes an already-
// closed race window observable within a short, deterministic test rather than needing rare real-world
// timing (see `Composer.tsx`'s `focusCaret` comment for the fuller mechanism writeup).
test("a recall step immediately followed by a full-value replace never doubles the value, even under CPU contention", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	// No explicit `id`: this test loops many repeated recall/replace cycles and is meant to be re-run
	// under `--repeat-each` to prove the race stays closed. A fixed literal id would collide with an
	// in-memory session entry from an earlier repeat's (differently-`workspaceId`'d) run within the same
	// shared webServer lifetime, failing with "Unknown session" before ever reaching the code path this
	// test exists to exercise — the default fresh-per-call id (`seedWorkspaceSession`) sidesteps that.
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{ role: "user", text: "write a test for the jitter", timestamp: 1_700_500_000_000 },
			{ role: "assistant", text: "Added a test.", timestamp: 1_700_500_001_000 },
		],
	});

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("project-item").first().click();
	await page.getByTestId("workspace-item").first().click();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-item").first().click();
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();
	await expect(input).toHaveValue("");

	// Throttle the main thread so any reintroduced deferred-callback gap (RAF or otherwise) would widen
	// enough to be caught reliably within a handful of iterations — this is what let the old RAF-based
	// code reproduce the doubled value in ~3% of iterations during root-cause diagnosis. `press` and
	// `fill` still auto-wait/retry as usual; only real wall-clock CPU speed is reduced.
	const client = await page.context().newCDPSession(page);
	await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

	for (let i = 0; i < 200; i++) {
		await input.press("ArrowUp");
		await expect(input).toHaveValue("write a test for the jitter");
		const replacement = `edit ${i}`;
		await input.fill(replacement);
		// A snapshot read, not the auto-retrying `toHaveValue` matcher: the corruption this pins is an
		// immediate, permanent doubling at `fill`-completion time, not a transient state that later
		// settles — polling could mask a regression that briefly shows the wrong value.
		expect(await input.inputValue()).toBe(replacement);
		await input.fill("");
	}
});

// Regression: `recentPrompts`'s dedup must keep a repeated prompt's NEWEST occurrence (recency-first,
// matching the server history index's own ranking rule and the atuin/fzf convention) — not its oldest.
// "alpha" is said twice, "beta" once, in between: the first ArrowUp must recall "alpha" (the most recent
// prompt), the second must recall "beta", and a third must stay clamped on "beta" — proving "alpha" backs
// exactly one recall slot (its newest), not two.
test("a prompt repeated earlier in the chat recalls at its most recent position, deduped to one entry", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	// No explicit `id` — same reasoning as the recall test above: this test never references the seeded
	// session by id, so the default fresh-per-call id (survives a same-process retry) is enough.
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{ role: "user", text: "alpha", timestamp: 1_700_450_000_000 },
			{ role: "assistant", text: "ok", timestamp: 1_700_450_001_000 },
			{ role: "user", text: "beta", timestamp: 1_700_450_002_000 },
			{ role: "assistant", text: "ok", timestamp: 1_700_450_003_000 },
			{ role: "user", text: "alpha", timestamp: 1_700_450_004_000 },
			{ role: "assistant", text: "ok", timestamp: 1_700_450_005_000 },
		],
	});

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("project-item").first().click();
	await page.getByTestId("workspace-item").first().click();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-item").first().click();
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();
	await expect(input).toHaveValue("");

	await input.press("ArrowUp");
	await expect(input).toHaveValue("alpha");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("beta");
	// Clamped at "beta" — if the earlier "alpha" occurrence were a distinct entry, this would step to it.
	await input.press("ArrowUp");
	await expect(input).toHaveValue("beta");
});

// A9's mobile-discoverability half: `HistoryOverlay` sizes itself with `left-sm right-sm` insets (see
// `HistoryOverlay.tsx`) rather than a fixed pixel width, specifically so it can't overflow a narrow
// container. The app's three-pane layout (`shell/Shell.tsx`) isn't itself the "mobile single-view shell"
// `architecture.md` describes — that's a separate, not-yet-built concern — so this only isolates what IS
// this task's concern: the overlay's own sizing at a narrow (~390px, a small-phone width) viewport. Resize
// only for the check itself (after the normal desktop-sized setup) so a squeezed three-pane layout can't
// make the setup flow itself flaky.
test("the history overlay stays inside the viewport and its query stays focusable at a narrow (~390px) width", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	await page.setViewportSize({ width: 390, height: 844 });

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	await input.press("Control+r");
	await expect(overlay).toBeVisible();

	const viewportSize = page.viewportSize();
	const box = await overlay.boundingBox();
	expect(box).not.toBeNull();
	expect(viewportSize).not.toBeNull();
	if (box && viewportSize) {
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewportSize.width);
	}

	const query = page.getByTestId("history-query");
	await expect(query).toBeVisible();
	await expect(query).toBeFocused();
});

// Reviewer-flagged regression: the results list itself scrolls (mouse wheel, drag), but before this fix
// keyboard-only navigation never moved that scroll position on its own — repeatedly pressing ArrowDown
// could walk `selected` well past the bottom of what's currently visible, leaving the highlighted row
// entirely offscreen inside the `overflow-y-auto` results container. `HistoryOverlay` now scrolls the
// selected row into view (`Element.scrollIntoView({ block: "nearest" })`) whenever the selection changes.
test("ArrowDown repeatedly scrolls the keyboard-selected row into view inside the results container", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	// 30 distinct prompts, all in this workspace's own cwd — comfortably more than fit inside the compact
	// stage's `max-h-[40vh]`. An empty query in the default "workspace" scope (no scope cycling needed)
	// surfaces every one of them as a recent prompt (see `historyIndex.test.ts`'s "(d) empty query returns
	// recent prompts"), well under the 50-item server cap, so none get paged out.
	seedWorkspaceSession(workspace.worktreePath, {
		messages: Array.from({ length: 30 }, (_, i) => ({
			role: "user" as const,
			text: `prompt number ${String(i).padStart(2, "0")}`,
			timestamp: 1_700_600_000_000 + i * 1_000,
		})),
	});
	await page.waitForTimeout(2_100);

	await page.getByTestId("start-chat").click();
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	await expect(page.locator('[data-testid="history-item"][data-kind="prompt"]')).toHaveCount(30);

	const query = page.getByTestId("history-query");
	const results = page.getByTestId("history-results");
	const selectedRow = page.locator('[data-testid="history-item"][data-selected="true"]');

	// Walk the selection deep into the list — well past what the compact stage can show without scrolling.
	for (let i = 0; i < 25; i++) {
		await query.press("ArrowDown");
	}
	await expect(selectedRow).toHaveCount(1);

	// The selected row's own layout box (real position, regardless of the container's overflow-clipping)
	// must sit entirely within the results container's box — i.e. the container actually scrolled to bring
	// it into view, rather than leaving it below the visible range.
	const resultsBox = await results.boundingBox();
	const rowBox = await selectedRow.boundingBox();
	expect(resultsBox).not.toBeNull();
	expect(rowBox).not.toBeNull();
	if (resultsBox && rowBox) {
		expect(rowBox.y).toBeGreaterThanOrEqual(resultsBox.y);
		expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(resultsBox.y + resultsBox.height);
	}
});

// R1: the zoomed stage's two-pane preview (`data-testid="history-preview"`) shows the keyboard-selected
// item's FULL text — never the row's truncated first line — with query terms highlighted the same way a
// row highlights its own text (`Highlight` is reused verbatim, never forked). The compact stage has no
// preview pane in the DOM at all (not merely hidden), and moving the keyboard selection swaps the preview
// to match the newly-selected item.
test("the zoomed stage's preview pane shows the selected item's full text, including a tail truncated in its row, and updates on ArrowDown; the compact stage has no preview at all", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	// A 3-line, >200-char prompt whose FIRST line never mentions the tail marker "zephyr9000" —
	// `PromptRow` shows only `hit.text.split("\n")[0]`, so a hit whose full text matched the query can
	// still show a row whose visible first line doesn't contain the very term that matched. That's the
	// "truncated in the row" case R1's preview pane exists for.
	const longPrompt = [
		"Investigate the deployment pipeline failure end to end before the next release window opens.",
		"Check the retry policy, the queue backlog depth, and every healthcheck threshold across all services.",
		"Root cause found: the zephyr9000 rollback trigger misfired under load and needs a guard added.",
	].join("\n");
	expect(longPrompt.length).toBeGreaterThan(200);
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{ role: "user", text: longPrompt, timestamp: 1_700_900_000_000 },
			{ role: "user", text: "a shorter unrelated prompt", timestamp: 1_700_900_001_000 },
		],
	});
	await page.waitForTimeout(2_100);

	await page.getByTestId("start-chat").click();
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	const preview = page.getByTestId("history-preview");

	// Compact stage: the preview pane doesn't exist in the DOM at all, not merely hidden.
	await expect(preview).toHaveCount(0);

	await query.fill("zephyr9000");
	const longRow = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "Investigate the deployment pipeline" });
	await expect(longRow).toBeVisible();
	// The row shows only the truncated first line — the tail term that actually matched never appears.
	await expect(longRow).not.toContainText("zephyr9000");

	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	await expect(preview).toBeVisible();
	// The preview shows the FULL text, including the tail the row truncated away.
	await expect(preview).toContainText("zephyr9000");
	await expect(preview).toContainText("Investigate the deployment pipeline failure");

	// Broaden to an empty query so both seeded prompts are in the flat list; newest first ("a shorter
	// unrelated prompt", seeded one second later) is selected initially — the preview follows.
	await query.fill("");
	await expect(page.locator('[data-testid="history-item"][data-kind="prompt"]')).toHaveCount(2);
	await expect(preview).toContainText("a shorter unrelated prompt");
	await expect(preview).not.toContainText("zephyr9000");

	// ArrowDown moves the keyboard selection onto the long prompt — the preview updates to match.
	await query.press("ArrowDown");
	await expect(preview).toContainText("zephyr9000");
	await expect(preview).toContainText("Investigate the deployment pipeline failure");
});

// R1: at a narrow (~390px) viewport, the zoomed stage's preview pane stacks BELOW the results list
// instead of beside it — the two-pane wrapper switches to a column flex layout under the `md` breakpoint
// (the same convention `SettingsDialog`'s own two-pane shell uses). Keeps the existing 390px overlay-
// sizing e2e (above) passing unmodified — this is a separate assertion about the *zoomed* stage only.
test("at a narrow (~390px) viewport, the zoomed stage's preview pane stacks below the results list, both visible", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{
				role: "user",
				text: "a narrow-viewport preview stacking test prompt",
				timestamp: 1_701_000_000_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	await page.getByTestId("start-chat").click();
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	const results = page.getByTestId("history-results");
	const preview = page.getByTestId("history-preview");
	await expect(results).toBeVisible();
	await expect(preview).toBeVisible();

	const resultsBox = await results.boundingBox();
	const previewBox = await preview.boundingBox();
	expect(resultsBox).not.toBeNull();
	expect(previewBox).not.toBeNull();
	if (resultsBox && previewBox) {
		// Stacked, list first: the preview's top sits at or below the list's own bottom edge.
		expect(previewBox.y).toBeGreaterThanOrEqual(resultsBox.y + resultsBox.height - 1);
	}
});

// R2: the scope badge is now a dropdown picker (the discoverable mouse path — atuin's "cycling is
// invisible" lesson) alongside the unchanged `Ctrl+R` cycle. Also proves the brief's sharp edge: while
// the picker is open, ArrowDown belongs to the menu, never to the overlay's own results selection —
// Radix's portaled content is a sibling of the query `<input>` the overlay's key handler is bound to,
// never its descendant, so there's nothing for the two handlers to double up on; this test is the proof.
test("the scope badge opens a picker that selects a scope directly without disturbing the results selection, returns focus to the query input, and Ctrl+R still cycles afterward", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{
				role: "user",
				text: "alpha prompt for the scope picker test",
				timestamp: 1_701_100_000_000,
			},
			{ role: "user", text: "beta prompt for the scope picker test", timestamp: 1_701_100_001_000 },
		],
	});
	seedExternalCwdSessions();
	await page.waitForTimeout(2_100);

	await page.getByTestId("start-chat").click();
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");
	const scopeOptions = page.getByTestId("history-scope-option");
	const selectedRow = page.locator('[data-testid="history-item"][data-selected="true"]');

	// Default "workspace" scope, empty query: both seeded prompts, newest ("beta…") first and selected.
	await expect(page.locator('[data-testid="history-item"][data-kind="prompt"]')).toHaveCount(2);
	await expect(selectedRow).toContainText("beta prompt for the scope picker test");

	// Click the badge → 4 options, correct data-scopes, in cycle order.
	await scopeBadge.click();
	await expect(scopeOptions).toHaveCount(4);
	await expect(scopeOptions.nth(0)).toHaveAttribute("data-scope", "chat");
	await expect(scopeOptions.nth(1)).toHaveAttribute("data-scope", "workspace");
	await expect(scopeOptions.nth(2)).toHaveAttribute("data-scope", "project");
	await expect(scopeOptions.nth(3)).toHaveAttribute("data-scope", "all");

	// Sharp edge: ArrowDown while the menu is open belongs to the menu, not the overlay's results list.
	await page.keyboard.press("ArrowDown");
	await expect(selectedRow).toContainText("beta prompt for the scope picker test");

	// Click "Everywhere" selects it directly (no Ctrl+R needed), closes the menu, and returns focus to
	// the query input.
	await scopeOptions.filter({ hasText: "Everywhere" }).click();
	await expect(scopeBadge).toHaveAttribute("data-scope", "all");
	await expect(query).toBeFocused();
	await expect(
		page
			.locator('[data-testid="history-item"][data-kind="prompt"]')
			.filter({ hasText: "deploy the docs site" }),
	).toBeVisible();

	// Ctrl+R still cycles after the mouse pick — from "all" it wraps forward to "chat".
	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "chat");
});
