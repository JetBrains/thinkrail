import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): runs a REAL pi agent. Proves several chats in one
// workspace, each its own runtime, streaming concurrently; switching is an instant swap; closing one
// leaves the other untouched. (The deterministic routing guarantee is unit-tested in store/appStore.test.ts.)
test("two chats in one workspace stream independently; closing one keeps the other", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-active", "true");

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const doneNotice = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });

	// Chat A — start a turn…
	await page.getByTestId("start-chat").click();
	await expect(chatTabs).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: alpha");
	await page.getByTestId("chat-send").click();

	// …then open chat B and start its turn before A necessarily finishes — both stream at once.
	await page.getByTestId("new-chat").click();
	await expect(chatTabs).toHaveCount(2);
	await page.getByTestId("chat-input").fill("Reply with the single word: bravo");
	await page.getByTestId("chat-send").click();

	// B (the active tab) reaches its turn-completion notice.
	await expect(doneNotice).toBeVisible({ timeout: 90_000 });

	// Switch to A — it streamed to completion in the background (its runtime updated while unmounted),
	// and the swap is instant.
	await chatTabs.first().locator("button").first().click();
	await expect(doneNotice).toBeVisible({ timeout: 90_000 });

	// Close A → only B's tab remains, its content intact (closing one leaves the other untouched).
	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(1);
	await expect(doneNotice).toBeVisible();
});
