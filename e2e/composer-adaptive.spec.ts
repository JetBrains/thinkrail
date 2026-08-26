import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

async function box(locator: import("@playwright/test").Locator) {
	const value = await locator.boundingBox();
	if (!value) throw new Error("composer element has no layout box");
	return value;
}

test("idle composer is one line and unfolds only when the draft needs it", async ({ page }) => {
	await openWorkspaceChat(page);

	const composer = page.getByTestId("chat-composer");
	const shell = page.getByTestId("chat-composer-shell");
	const input = page.getByTestId("chat-input");
	const model = page.getByTestId("model-selector");
	const effort = page.getByTestId("thinking-selector");
	const history = page.getByTestId("history-open");
	const send = page.getByTestId("chat-send");

	const compactInput = await box(input);
	expect(compactInput.height).toBeGreaterThanOrEqual(32);
	expect(compactInput.height).toBeLessThanOrEqual(40);
	await expect(composer).toHaveAttribute("data-expanded", "false");
	expect((await box(shell)).height).toBeLessThanOrEqual(50);

	for (const control of [model, effort, history, send]) {
		const controlBox = await box(control);
		expect(Math.abs(controlBox.y + controlBox.height - (compactInput.y + compactInput.height))).toBeLessThanOrEqual(4);
	}

	await input.fill("Inspect the retry flow.\nThen add focused coverage.");
	await expect(composer).toHaveAttribute("data-expanded", "true");
	const expandedInput = await box(input);
	expect(expandedInput.height).toBeGreaterThan(compactInput.height);
	expect((await box(model)).y).toBeGreaterThanOrEqual(expandedInput.y + expandedInput.height);

	await input.fill("Short follow-up");
	await expect(composer).toHaveAttribute("data-expanded", "false");
	expect((await box(input)).height).toBeLessThanOrEqual(40);
});

test("half-chat growth caps the editor shell and scrolls the textarea", async ({ page }) => {
	await openWorkspaceChat(page);

	const chat = page.getByTestId("chat-view");
	const composer = page.getByTestId("chat-composer");
	const shell = page.getByTestId("chat-composer-shell");
	const input = page.getByTestId("chat-input");
	await input.fill(Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n"));
	await expect(composer).toHaveAttribute("data-expanded", "true");

	const chatBox = await box(chat);
	const shellBox = await box(shell);
	expect(shellBox.height).toBeLessThanOrEqual(chatBox.height * 0.5 + 2);
	const overflow = await input.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
		overflowY: getComputedStyle(element).overflowY,
	}));
	expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
	expect(overflow.overflowY).toBe("auto");
});

test("chat growth setting persists and compact means six visual lines", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();

	const compact = page.getByTestId("composer-growth-compact");
	const roomy = page.getByTestId("composer-growth-roomy");
	const half = page.getByTestId("composer-growth-half-chat");
	await expect(compact).toBeVisible();
	await expect(roomy).toBeVisible();
	await expect(half).toHaveAttribute("data-active", "true");
	await compact.click();
	await expect(compact).toHaveAttribute("data-active", "true");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	await expect(compact).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");

	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");
	await input.fill(Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"));
	const lines = await input.evaluate((element) => {
		const styles = getComputedStyle(element);
		return (
			(element.clientHeight - Number.parseFloat(styles.paddingTop) - Number.parseFloat(styles.paddingBottom)) /
			Number.parseFloat(styles.lineHeight)
		);
	});
	expect(lines).toBeGreaterThanOrEqual(5.9);
	expect(lines).toBeLessThanOrEqual(6.1);

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	await half.click();
	await expect(half).toHaveAttribute("data-active", "true");
});

test("compact phone controls remain inside the chat viewport", async ({ page }) => {
	await openWorkspaceChat(page);
	await page.setViewportSize({ width: 320, height: 720 });

	const composer = page.getByTestId("chat-composer");
	await expect(composer).toHaveAttribute("data-expanded", "false");
	for (const control of [
		page.getByTestId("model-selector"),
		page.getByTestId("thinking-selector"),
		page.getByTestId("history-open"),
		page.getByTestId("chat-send"),
	]) {
		const controlBox = await box(control);
		expect(controlBox.x).toBeGreaterThanOrEqual(0);
		expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(320);
	}
	expect((await box(page.getByTestId("chat-input"))).height).toBeLessThanOrEqual(40);
});
