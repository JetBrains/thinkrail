import { expect, test } from "@playwright/test";
import { openFixtureProject, worktreeRows } from "./fixtures/app";

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

	const model = dialog.getByTestId("model-selector");
	await expect(model).toBeEnabled();
	await expect(model).not.toContainText("Default model");
	await expect(model).not.toContainText("Select model");

	await model.click();
	const list = page.locator("[cmdk-list]");
	await expect(page.getByTestId("model-option").first()).toBeVisible();
	await expect(list).toHaveJSProperty("scrollTop", 0);
	await list.hover();
	await page.mouse.wheel(0, 600);
	await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	await page.keyboard.press("Escape");

	const effort = dialog.getByTestId("thinking-selector");
	await expect(effort).toBeEnabled();
	await effort.click();
	const options = page.getByTestId("thinking-option");
	expect(await options.count()).toBeGreaterThan(0);
	const level = await options.last().getAttribute("data-level");
	await options.last().click();
	await expect(effort).toContainText(String(level));
});

test("Create with a prompt cuts a worktree and streams the answer in a new chat", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(90_000);
	await openFixtureProject(page);

	await kickOff(page, "Reply with the single word: pong");

	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: "pong" }),
	).toBeVisible();

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

	await kickOff(page, "Reply with the single word: alpha");
	await expect(worktreeRows(page)).toHaveCount(1);

	await kickOff(page, "Reply with the single word: bravo");
	await expect(worktreeRows(page)).toHaveCount(2);

	await expect(doneNotice).toBeVisible({ timeout: 90_000 });

	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await expect(doneNotice).toBeVisible({ timeout: 90_000 });
});
