import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent against the seeded prompt-template
// fixtures (`e2e/fixtures/templates.ts`). The no-agent `templates-compose.spec.ts` already covers the
// composer's slot-session mechanics end to end (against a rejected send — no auth in that suite); these
// two specs are what actually reach a live agent: the menu path (client-expanded plain text — proving a
// real turn still completes) and the typed-through path (a literal `/name args` prompt, which never
// touches the slot parser at all — it rides pi's OWN server-side expansion, `PromptOptions.
// expandPromptTemplates`, default `true`; see `packages/server/src/agent/SPEC.md`). The typed-through test
// is also what resolves the design's "to verify" #3 — how pi records an expanded prompt in the transcript
// — empirically; the observed result is documented in `apps/web/src/chat/SPEC.md`'s Template slots bullet.

test("picking the seeded template from the / menu sends the expanded text and gets a reply", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(90_000);
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");

	// `/rev` matches only the fixture template (`review.md`: `Review $1 for issues, focusing on
	// ${2:-src/}.`) — same pick as `templates-compose.spec.ts`, but sent to a real agent instead of just
	// asserting the client-side draft.
	await input.fill("/rev");
	const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
	await expect(rows).toHaveCount(1);
	await rows.first().click();
	await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

	// Fill slot 1/2; Tab to slot 2/2 and leave its prefilled default ("src/") untouched.
	await page.keyboard.type("README.md");
	await expect(input).toHaveValue(/^Review README\.md for issues, focusing on src\/\.\s*$/);
	await input.press("Tab");
	await expect(page.getByTestId("slot-hint")).toContainText("slot 2/2");

	await page.getByTestId("chat-send").click();

	// The menu path always sends pre-expanded plain text (Composer's own slot substitution never
	// produces a `/name` string), so the bubble is the fully-expanded body: both slot fills are present,
	// no leftover marker glyph, and no literal command name.
	const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(bubble).toContainText("README.md");
	await expect(bubble).toContainText("src/");
	await expect(bubble).not.toContainText("⟨");
	await expect(bubble).not.toContainText("/review");

	// An assistant reply arrives — any non-error completion (`agent_end` without a `stopReason: "error"`
	// last message renders "✓ Done"; an error renders a distinct `ErrorTurn` instead — see
	// `store/appStore.ts`'s `agent_end` case). The pinned e2e default model; content isn't asserted.
	await waitForDone(page);
});

test("a typed-through /name command is expanded by pi itself, not the composer's slot parser", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");

	// Type the command literally — never picking it from the menu. Real per-character key events
	// (`keyboard.type`, not `.fill`) are what exercise the menu's live-closing transition: `slashQuery`
	// (Composer.tsx) goes null the instant ANY space lands in the value, so the menu already closes
	// right after "/review " — long before the trailing space this prompt happens to end with.
	await input.click();
	await page.keyboard.type("/review alpha beta ");
	await expect(page.getByTestId("slash-menu")).toHaveCount(0);
	await page.keyboard.press("Enter");

	// The trailing space is trimmed at submit, so "/review alpha beta" (no client-side expansion — this
	// never touched `insertTemplate`/the slot parser) is what's actually sent. This first bubble is the
	// web client's own OPTIMISTIC echo (`ChatView.onSubmit` → `appendUserMessage`: store-only, appended
	// before the transport call resolves) — it always shows exactly what was typed, regardless of what
	// the agent does with the text next.
	const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(bubble).toHaveText("/review alpha beta");

	await waitForDone(page);

	// Reload to inspect what pi actually PERSISTED, not the client's optimistic echo: a fresh page has
	// no in-memory runtime for this session, so `CenterTabs`'s hydrate-on-connect effect refetches
	// `session.getMessages` and rebuilds the transcript from pi's own message list
	// (`messagesToRuntime`) — the same "come back later" path `history-jump.spec.ts`/
	// `history-search.spec.ts` use to inspect a session's durable record. A reload doesn't auto-restore
	// the active project/workspace, so re-pick both.
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("project-item").first().click();
	await page.getByTestId("workspace-item").first().click();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	// The session is still live in the host's memory (never closed), so it auto-restores as the active
	// tab — no history entry to reopen from.
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const restoredBubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(restoredBubble).toBeVisible();

	// OBSERVED (see `apps/web/src/chat/SPEC.md`'s Template slots bullet): pi's `AgentSession.prompt()`
	// substitutes args into `expandedText` *before* persisting the `role: "user"` message, so its own
	// transcript carries the fully-expanded body — never the raw typed command — once re-fetched.
	await expect(restoredBubble).toContainText("Review alpha for issues, focusing on beta.");
	await expect(restoredBubble).not.toContainText("/review");
});
