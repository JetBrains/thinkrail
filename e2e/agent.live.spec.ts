import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

// Tagged @agent: excluded from the default `bun run e2e` (--grep-invert @agent); run via `bun run
// e2e:agent` (or `bun run e2e:full`). It drives a REAL pi agent using pi's **default auth** (the model
// runtime resolves provider env vars or `~/.pi/agent/auth.json`) — run it where `pi` is authenticated. No fake.
test("streams an assistant reply from a real provider", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(90_000); // real provider latency varies — don't fail on a slow turn under the 30s default
	await openFixtureProject(page);

	// Create a workspace → it becomes active → chat is scoped to it.
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	// Start a chat from the empty-state button, then send a tiny prompt.
	await page.getByTestId("start-chat").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: pong");
	await page.getByTestId("chat-send").click();

	// Don't assert exact words — real models vary. Just require non-empty streamed assistant text.
	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').first();
	await expect(assistant).toBeVisible({ timeout: 60_000 });
	await expect(assistant).not.toBeEmpty({ timeout: 60_000 });
});
