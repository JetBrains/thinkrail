import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): runs a REAL pi agent. Proves the `start_new_chat` handoff
// end to end: the agent in one chat calls the tool, the host creates a sibling session in the same
// workspace and fires the kickoff prompt, the `session.created` push opens + focuses a second chat tab
// on this (active-workspace) client, and the new chat streams its kickoff turn. The compose ordering
// and store-fold matrix are unit-tested (server host/startNewChatCompose.test.ts, web store/appStore.test.ts).
test("'implement in new session' starts a second chat that opens focused and runs its kickoff", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const doneNotice = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });

	// Ask the origin chat to hand off. Name the tool explicitly so the run is deterministic — the
	// discovery-by-phrasing quality ("ok, implement in new session") is prompt-tuning, not wiring.
	await expect(chatTabs).toHaveCount(1);
	await page
		.getByTestId("chat-input")
		.fill(
			'Use the start_new_chat tool now, with title "Handoff Target" and prompt "Reply with the single word: kicked". Do nothing else.',
		);
	await page.getByTestId("chat-send").click();

	// The session.created push opens the new chat tab on this client (its workspace is active here)…
	await expect(chatTabs).toHaveCount(2, { timeout: 120_000 });
	// …focused (the fold activates the tab), and named by the tool's title.
	const newTab = chatTabs.nth(1);
	await expect(newTab).toHaveAttribute("data-active", "true");
	await expect(newTab).toContainText("Handoff Target");

	// The kickoff prompt arrived via the event stream (a host-fired user message — no client sent it)
	// and the new chat ran it to completion.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: "kicked" }),
	).toBeVisible({ timeout: 60_000 });
	await expect(doneNotice).toBeVisible({ timeout: 120_000 });

	// The origin chat holds the handoff receipt: switch back and find the tool card's title.
	await chatTabs.first().locator("button").first().click();
	await expect(page.getByText("Handoff Target").first()).toBeVisible({ timeout: 30_000 });
});
