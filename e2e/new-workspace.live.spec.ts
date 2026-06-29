import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent. Proves the M14 headline — the
// New-Workspace dialog's "create + kick-off": Create with a prompt cuts a worktree, opens a chat in it,
// and sends the prompt; and a second dialog kick-off in another workspace streams concurrently (which
// works only because the web client went per-session at M13).

/** Open the New-Workspace dialog from the first project's "+", type a prompt, and Create. */
async function kickOff(page: import("@playwright/test").Page, prompt: string): Promise<void> {
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(async () => {
		if (!(await dialog.isVisible())) await page.getByTestId("add-workspace").first().click();
		await expect(dialog).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 30_000 });
	await page.getByTestId("ws-prompt").fill(prompt);
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
}

test("the dialog shows the exact default model and its picker scrolls inside the dialog", {
	tag: "@agent",
}, async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();

	// #1 — the picker shows the resolved default model (a real name), not a "Default model" placeholder.
	const model = dialog.getByTestId("model-selector");
	await expect(model).toBeEnabled();
	await expect(model).not.toContainText("Default model");
	await expect(model).not.toContainText("Select model");

	// #2 — the model list (portaled into the dialog) scrolls by wheel under the Dialog's scroll lock.
	await model.click();
	const list = page.locator("[cmdk-list]");
	await expect(page.getByTestId("model-option").first()).toBeVisible();
	await expect(list).toHaveJSProperty("scrollTop", 0);
	await list.hover();
	await page.mouse.wheel(0, 600);
	await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("Create with a prompt cuts a worktree and streams the answer in a new chat", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(90_000);
	await openFixtureProject(page);

	await kickOff(page, "Reply with the single word: pong");

	// A worktree appears + becomes active, and a chat tab opened with the prompt already sent.
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: "pong" }),
	).toBeVisible();

	// The assistant streams a non-empty reply from the real provider.
	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').first();
	await expect(assistant).toBeVisible({ timeout: 60_000 });
	await expect(assistant).not.toBeEmpty({ timeout: 60_000 });
});

test("two dialog kick-offs in separate workspaces stream concurrently", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);

	const doneNotice = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });

	// Workspace A — kick off a turn…
	await kickOff(page, "Reply with the single word: alpha");
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);

	// …then immediately spin up workspace B with its own kick-off, before A necessarily finishes.
	await kickOff(page, "Reply with the single word: bravo");
	await expect(page.getByTestId("workspace-item")).toHaveCount(2);

	// B (now active) reaches its turn-completion notice while A streamed in the background.
	await expect(doneNotice).toBeVisible({ timeout: 90_000 });

	// Switch back to workspace A → its chat streamed to completion concurrently (background runtime).
	await page.getByTestId("workspace-item").nth(0).getByRole("button").first().click();
	await expect(doneNotice).toBeVisible({ timeout: 90_000 });
});
