import { expect, test } from "@playwright/test";
import { hideAuxiliaryWorkbench, openWorkspaceChat, PHONE_VIEWPORT } from "./fixtures/app";

async function box(locator: import("@playwright/test").Locator) {
	const value = await locator.boundingBox();
	if (!value) throw new Error("composer element has no layout box");
	return value;
}

test("idle composer keeps one message line above a stable controls row", async ({ page }) => {
	await openWorkspaceChat(page);

	const composer = page.getByTestId("chat-composer");
	const shell = page.getByTestId("chat-composer-shell");
	const input = page.getByTestId("chat-input");
	const model = page.getByTestId("model-selector");
	const history = page.getByTestId("history-open");
	const send = page.getByTestId("chat-send");

	const compactShell = await box(shell);
	const compactInput = await box(input);
	const compactWrapMeasure = await box(page.getByTestId("chat-input-sizer"));
	const compactModel = await box(model);
	expect(compactInput.height).toBeGreaterThanOrEqual(32);
	expect(compactInput.height).toBeLessThanOrEqual(40);
	await expect(composer).toHaveAttribute("data-expanded", "false");
	expect(compactShell.height).toBeGreaterThanOrEqual(compactInput.height + compactModel.height);
	expect(compactInput.x).toBeLessThanOrEqual(compactShell.x + 8);
	expect(compactInput.x + compactInput.width).toBeGreaterThanOrEqual(
		compactShell.x + compactShell.width - 8,
	);
	expect(Math.abs(compactWrapMeasure.x - compactInput.x)).toBeLessThanOrEqual(0.5);
	expect(Math.abs(compactWrapMeasure.width - compactInput.width)).toBeLessThanOrEqual(0.5);

	const compactFooterBottom = compactModel.y + compactModel.height;
	for (const control of [model, history, send]) {
		const controlBox = await box(control);
		expect(controlBox.y).toBeGreaterThanOrEqual(compactInput.y + compactInput.height);
		expect(Math.abs(controlBox.y + controlBox.height - compactFooterBottom)).toBeLessThanOrEqual(4);
	}

	await input.fill("Inspect the retry flow.\nThen add focused coverage.");
	await expect(composer).toHaveAttribute("data-expanded", "true");
	const expandedInput = await box(input);
	const expandedModel = await box(model);
	expect(expandedInput.height).toBeGreaterThan(compactInput.height);
	expect(expandedModel.y).toBeGreaterThanOrEqual(expandedInput.y + expandedInput.height);
	expect(Math.abs(expandedModel.y - compactModel.y)).toBeLessThanOrEqual(2);

	await input.fill("Short follow-up");
	await expect(composer).toHaveAttribute("data-expanded", "false");
	expect((await box(input)).height).toBeLessThanOrEqual(40);
	expect(Math.abs((await box(model)).y - compactModel.y)).toBeLessThanOrEqual(2);
});

test("panel width changes expand and collapse the same textarea", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 900 });
	await openWorkspaceChat(page);

	const composer = page.getByTestId("chat-composer");
	const input = page.getByTestId("chat-input");
	const initialElement = await input.elementHandle();
	if (!initialElement) throw new Error("composer textarea missing");
	await input.fill(
		"Keep the same focused draft and selection while a narrower mounted chat panel makes this line wrap.",
	);
	await expect(composer).toHaveAttribute("data-expanded", "false");
	await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(18, 18));

	await page.setViewportSize({ width: 700, height: 900 });
	await expect(composer).toHaveAttribute("data-expanded", "true");
	expect(await input.evaluate((element, initial) => element === initial, initialElement)).toBe(
		true,
	);
	expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(18);

	await page.setViewportSize({ width: 1920, height: 900 });
	await expect(composer).toHaveAttribute("data-expanded", "false");
	expect(await input.evaluate((element, initial) => element === initial, initialElement)).toBe(
		true,
	);
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
			(element.clientHeight -
				Number.parseFloat(styles.paddingTop) -
				Number.parseFloat(styles.paddingBottom)) /
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
	await hideAuxiliaryWorkbench(page);
	await page.setViewportSize(PHONE_VIEWPORT);

	const composer = page.getByTestId("chat-composer");
	await expect(composer).toHaveAttribute("data-expanded", "false");
	const shellBox = await box(page.getByTestId("chat-composer-shell"));
	const idleTextMetrics = await page.getByTestId("chat-input").evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}));
	expect(idleTextMetrics.scrollHeight).toBeLessThanOrEqual(idleTextMetrics.clientHeight);
	expect(shellBox.x).toBeGreaterThanOrEqual(0);
	expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
	for (const control of [
		page.getByTestId("model-selector"),
		page.getByTestId("history-open"),
		page.getByTestId("chat-send"),
	]) {
		const controlBox = await box(control);
		expect(controlBox.x).toBeGreaterThanOrEqual(0);
		expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
	}
	const inputBox = await box(page.getByTestId("chat-input"));
	expect(inputBox.height).toBeLessThanOrEqual(40);
	expect(inputBox.x).toBeLessThanOrEqual(shellBox.x + 8);
	expect(inputBox.x + inputBox.width).toBeGreaterThanOrEqual(shellBox.x + shellBox.width - 8);
	expect((await box(page.getByTestId("model-selector"))).y).toBeGreaterThanOrEqual(
		inputBox.y + inputBox.height,
	);
});

test("pressing composer padding focuses the input without stealing control clicks", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	const model = page.getByTestId("model-selector");
	const history = page.getByTestId("history-open");
	const modelBox = await box(model);
	const historyBox = await box(history);
	const sendBox = await box(page.getByTestId("chat-send"));
	const footerGap = {
		x: (modelBox.x + modelBox.width + historyBox.x) / 2,
		y: modelBox.y + modelBox.height / 2,
	};
	const presses = [
		footerGap,
		{ x: footerGap.x, y: modelBox.y - 2 },
		{ x: historyBox.x + historyBox.width + 2, y: historyBox.y + historyBox.height / 2 },
		{ x: sendBox.x + sendBox.width / 2, y: sendBox.y + sendBox.height / 2 },
	];
	for (const { x, y } of presses) {
		await input.blur();
		await expect(input).not.toBeFocused();
		await page.mouse.click(x, y);
		await expect(input).toBeFocused();
	}

	await input.fill("draft");
	await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 2));
	await input.blur();
	await page.mouse.click(footerGap.x, footerGap.y);
	await expect(input).toBeFocused();
	expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(2);

	await input.blur();
	await model.click();
	const refresh = page.getByTestId("model-refresh");
	await expect(refresh).toBeVisible();
	await expect(input).not.toBeFocused();
	const popover = refresh.locator("xpath=ancestor::*[@data-radix-popper-content-wrapper]");
	const popoverBox = await box(popover);
	await page.mouse.click(popoverBox.x + 2, popoverBox.y + 2);
	await expect(input).not.toBeFocused();
	await expect(refresh).toBeVisible();
});
