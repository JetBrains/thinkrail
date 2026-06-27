import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): a REAL pi agent + two browser tabs against ONE host. Proves M16
// (hydrate-then-stream): a second client reconstructs the workspace's chats + transcript on connect, and
// then sees live updates — because the host is the source of truth and the client hydrates + streams.
test("a second tab hydrates the same workspace's chats and then sees live updates", {
	tag: "@agent",
}, async ({ page, context }) => {
	test.setTimeout(120_000);
	const done = (p: typeof page) =>
		p.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" });

	// --- Tab A: create a workspace, open a chat, run a turn -----------------------------------------
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-active", "true");
	await page.getByTestId("start-chat").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: alpha");
	await page.getByTestId("chat-send").click();
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: "alpha" }),
	).toBeVisible();
	await expect(done(page)).toBeVisible({ timeout: 80_000 }); // first turn is complete + persisted

	// --- Tab B: a second tab on the same host ------------------------------------------------------
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// Navigate to the workspace tab A created (it's persisted + listed) → activating it triggers hydration.
	await page2.getByTestId("project-expand").first().click(); // expand → load workspaces
	await page2.getByTestId("workspace-item").first().click(); // activate → hydrate-on-connect

	// Tab B rebuilds the chat tab + its transcript purely from the host (it never witnessed the turn).
	await expect(page2.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1, {
		timeout: 30_000,
	});
	await expect(
		page2.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: "alpha" }),
	).toBeVisible({ timeout: 30_000 });
	// Hydration is from pi messages only — the "Done" notice (web-local) is NOT replayed yet.
	await expect(done(page2)).toHaveCount(0);

	// --- Live update: tab A drives the shared session; tab B sees it stream in --------------------
	await page.getByTestId("chat-input").fill("Now reply with the single word: bravo");
	await page.getByTestId("chat-send").click();
	// Tab B receives the broadcast pi.events for the shared session → its turn completes too.
	await expect(done(page2)).toBeVisible({ timeout: 80_000 });
});
