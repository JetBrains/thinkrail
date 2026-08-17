import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): a REAL pi agent. Pins the mid-stream hydration invariant:
// a client that hydrates while a turn streams (reload, second tab, workspace switch) must end up with
// exactly ONE copy of the streaming assistant message. This holds by construction today —
// `session.getMessages` returns only COMMITTED messages (pi keeps the in-flight partial in
// `streamingMessage`, pushing it to the transcript at message_end), and the reducer's adopt-by-mint
// path builds the live turn once — but a pi bump or a hydration change could silently break either
// half, and the symptom (a duplicated reply) is exactly the class of bug users report as duplication.
test("a reload mid-stream does not duplicate the streaming assistant message", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	// A deliberately long plain-text answer keeps the assistant message streaming for several
	// seconds — the window in which the reload's hydration snapshot contains the partial message.
	await page
		.getByTestId("chat-input")
		.fill(
			"Write the numbers 1 to 1000 separated by spaces, as plain text on one line. " +
				"No code blocks, no tools, no commentary — only the numbers.",
		);
	await page.getByTestId("chat-send").click();

	// Reload at the FIRST sign the assistant message is forming (message_start landed) — the earlier
	// the reload, the more stream is left to land after hydration.
	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	await expect(assistant.first()).toBeVisible({ timeout: 60_000 });

	// Reload mid-stream. The session keeps streaming host-side; the fresh page re-hydrates the
	// transcript (which includes the in-flight partial) and then receives the live updates.
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// A fresh load renders the project collapsed — re-activate the workspace to trigger hydration.
	await page.getByTestId("project-item").first().click();
	await expect(worktreeRows(page).first()).toBeVisible({ timeout: 15_000 });
	await worktreeRows(page).first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1, {
		timeout: 30_000,
	});
	// Guard: the turn must still be streaming when the hydrated chat lands, or this test exercised
	// nothing (the 1000-number answer keeps the window comfortably open past a reload + two clicks).
	await expect(page.getByTestId("stream-indicator")).toBeVisible({ timeout: 10_000 });

	// Let the turn finish: the live agent_end lands as the web-local "Done" notice.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 120_000 });

	// Exactly ONE assistant message: the hydrated turn was adopted by the live stream, not doubled.
	await expect(assistant).toHaveCount(1);
});
