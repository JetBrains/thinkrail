import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

async function openChat(page: import("@playwright/test").Page): Promise<void> {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	const trustDialog = page.getByTestId("new-workspace-dialog");
	await expect(trustDialog).toBeVisible();
	await trustDialog.getByTestId("ws-trust-project").click();
	await expect(trustDialog.getByTestId("ws-trust-notice")).toBeHidden();
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
}

test("composer prompt is moderately tall with model and effort controls underneath", {
	tag: "@agent",
}, async ({ page }) => {
	await openChat(page);

	const input = page.getByTestId("chat-input");
	const modelSelector = page.getByTestId("model-selector");
	const effortSelector = page.getByTestId("thinking-selector");
	const send = page.getByTestId("chat-send");

	await expect(input).toBeVisible();
	await expect(modelSelector).toBeVisible();
	await expect(effortSelector).toBeVisible();
	await expect(send).toBeVisible();

	const inputBox = await input.boundingBox();
	const modelBox = await modelSelector.boundingBox();
	const effortBox = await effortSelector.boundingBox();
	const sendBox = await send.boundingBox();
	if (!inputBox || !modelBox || !effortBox || !sendBox) {
		throw new Error("Composer layout boxes were not measurable");
	}

	expect(inputBox.height).toBeGreaterThanOrEqual(100);
	expect(inputBox.height).toBeLessThanOrEqual(130);
	const belowInputY = inputBox.y + inputBox.height;
	expect(modelBox.y).toBeGreaterThanOrEqual(belowInputY);
	expect(effortBox.y).toBeGreaterThanOrEqual(belowInputY);
	expect(sendBox.y).toBeGreaterThanOrEqual(belowInputY);
});

test("model picker plus file and portable-skill completion use the live session catalog", {
	tag: "@agent",
}, async ({ page }) => {
	await openChat(page);

	const modelSelector = page.getByTestId("model-selector");
	await expect(modelSelector).toBeEnabled();
	await modelSelector.click();
	await expect(page.getByTestId("model-option").first()).toBeVisible();
	expect(await page.getByTestId("model-option").count()).toBeGreaterThan(0);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("model-option")).toHaveCount(0);

	await expect(page.getByTestId("thinking-selector")).toBeVisible();

	await expect(page.getByTestId("session-stats")).toBeVisible();
	await expect(page.getByTestId("session-stats")).toContainText(/[?%]\/\d/);

	const input = page.getByTestId("chat-input");
	await input.fill("/e2e");
	const portableSkill = page
		.getByTestId("slash-command")
		.filter({ hasText: "/skill:e2e-portable" });
	await expect(portableSkill).toBeVisible();
	await expect(portableSkill).toContainText("skill/project");
	await input.press("Tab");
	await expect(input).toHaveValue("/skill:e2e-portable ");
	await input.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	);

	await input.fill("@RE");
	const mention = page.getByTestId("mention-item").filter({ hasText: "README.md" });
	await expect(mention).toBeVisible();
	await mention.click();
	await expect(input).toHaveValue(/@README\.md/);
});

test("stats refresh after a turn completes (cheap win #3)", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(90_000);
	await openChat(page);

	await page.getByTestId("chat-input").fill("Reply with the single word: pong");
	await page.getByTestId("chat-send").click();

	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 80_000 });
	const stats = page.getByTestId("session-stats");
	await expect(stats).toBeVisible();
	await expect(stats).toContainText(/[↑↓RW]/);

	await page.setViewportSize({ width: 320, height: 720 });
	const skills = page.getByTestId("open-skills");
	await expect(skills).toBeVisible();
	const statsBox = await stats.boundingBox();
	const skillsBox = await skills.boundingBox();
	if (!statsBox || !skillsBox) throw new Error("chat header item has no bounding box");
	for (const box of [statsBox, skillsBox]) {
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(320);
	}
});
