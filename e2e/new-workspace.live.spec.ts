import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openFixtureProject, worktreeRows } from "./fixtures/app";
import { isExactE2eModel, resolveE2eModel } from "./fixtures/centralAgent";
import { E2E_CENTRAL_ARTIFACT, E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

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
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);
	const authPath = join(E2E_PI_AGENT_DIR, "auth.json");
	if (existsSync(authPath))
		expect(Object.keys(JSON.parse(readFileSync(authPath, "utf8")))).toEqual([]);
	expect(existsSync(join(E2E_PI_AGENT_DIR, "models.json"))).toBe(false);

	const wire = await E2eWire.connect();
	const selected = await wire.request("model.default", {}).finally(() => wire.close());
	expect(isExactE2eModel(selected.model, resolveE2eModel())).toBe(true);
	if (!selected.model) throw new Error("Central agent model is missing after setup preflight");

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();

	const model = dialog.getByTestId("model-selector");
	await expect(model).toBeEnabled();
	await expect(model).toContainText(selected.model.name);

	await model.click();
	const list = page.locator("[cmdk-list]");
	const exactOption = page.getByTestId("model-option").filter({ hasText: selected.model.id });
	await expect(exactOption).toHaveCount(1);
	await expect(exactOption).toBeVisible();
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
