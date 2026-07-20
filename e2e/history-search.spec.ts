import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { seedExternalCwdSessions } from "./fixtures/sessions";

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
