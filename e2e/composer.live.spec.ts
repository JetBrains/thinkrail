import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): excluded from the default `bun run e2e`; run via
// `bun run e2e:agent`. These exercise the M12 Composer + cheap wins against a REAL pi agent + pi's
// default auth, since the model list and a session both need a working provider.

/** Create a workspace, open a chat tab in it, and wait for the composer to mount. */
async function openChat(page: import("@playwright/test").Page): Promise<void> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-active", "true");
	await page.getByTestId("start-chat").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
}

test("model picker lists models and @-mention completes a worktree file", {
	tag: "@agent",
}, async ({ page }) => {
	await openChat(page);

	// Cheap win #1 — the model selector populates from `model.list` once auth-backed models load.
	const modelSelector = page.getByTestId("model-selector");
	await expect(modelSelector).toBeEnabled();
	await modelSelector.click();
	await expect(page.getByTestId("model-option").first()).toBeVisible();
	expect(await page.getByTestId("model-option").count()).toBeGreaterThan(0);
	// Close WITHOUT selecting: a real pick calls `session.setModel`, which pi persists as the *default*
	// model — pinning the first-listed (possibly deprecated) model would break later turns this run.
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("model-option")).toHaveCount(0);

	// The thinking-level picker is the honest effort knob.
	await expect(page.getByTestId("thinking-selector")).toBeVisible();

	// Cheap win #3 — the stats bar renders (token/cost) as soon as the session reports stats.
	await expect(page.getByTestId("session-stats")).toBeVisible();
	await expect(page.getByTestId("session-stats")).toContainText(/tok/);

	// Composer @-mention: typing `@RE` lists the worktree's README.md and picking it inserts the path.
	await page.getByTestId("chat-input").fill("@RE");
	const mention = page.getByTestId("mention-item").filter({ hasText: "README.md" });
	await expect(mention).toBeVisible();
	await mention.click();
	await expect(page.getByTestId("chat-input")).toHaveValue(/@README\.md/);
});

test("stats refresh after a turn completes (cheap win #3)", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(90_000);
	await openChat(page);

	await page.getByTestId("chat-input").fill("Reply with the single word: pong");
	await page.getByTestId("chat-send").click();

	// Key off turn *completion* (the agent_end notice), not model output — the stats refresh hangs off
	// `agent_end`, and the env's default model may vary. The stats bar stays mounted with token/cost.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 80_000 });
	await expect(page.getByTestId("session-stats")).toBeVisible();
	await expect(page.getByTestId("session-stats")).toContainText(/tok/);
});
