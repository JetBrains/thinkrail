import { randomUUID } from "node:crypto";
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
	// Both message entries ("fix the flaky watcher test" reappearing as a message, and the assistant
	// reply) match "fix" — the Messages counter is the second `history-counts` (Prompts renders first).
	await expect(page.getByTestId("history-counts").last()).toHaveText("2/2");

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
	seedWorkspaceSession(workspace.worktreePath, {
		id: "e2e-recall-prompts",
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
	seedWorkspaceSession(workspace.worktreePath, {
		// Unique per run (unlike this file's other fixed literal ids): this test loops many repeated
		// recall/replace cycles and is meant to be re-run under `--repeat-each` to prove the race stays
		// closed. A fixed id would collide with an in-memory session entry from an earlier repeat's
		// (differently-`workspaceId`'d) run within the same shared webServer lifetime, failing with
		// "Unknown session" before ever reaching the code path this test exists to exercise.
		id: `e2e-recall-race-${randomUUID()}`,
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
	seedWorkspaceSession(workspace.worktreePath, {
		id: "e2e-recall-dedup",
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
