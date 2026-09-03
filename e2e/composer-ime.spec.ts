import { expect, type Locator, type Page, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

const ENTER_KEYCODE = 13;
const IME_SENTINEL_KEYCODE = 229;

interface ClientFrame {
	method?: string;
	params?: { text?: unknown };
}

function capturePromptTexts(page: Page): string[] {
	const prompts: string[] = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			try {
				const frame = JSON.parse(
					typeof payload === "string" ? payload : payload.toString(),
				) as ClientFrame;
				if (frame.method === "session.prompt" && typeof frame.params?.text === "string") {
					prompts.push(frame.params.text);
				}
			} catch {}
		});
	});
	return prompts;
}

async function dispatchEnter(
	input: Locator,
	init: { isComposing: boolean; keyCode: number },
): Promise<{ defaultPrevented: boolean; isComposing: boolean; keyCode: number }> {
	return input.evaluate((element, keyboard) => {
		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			code: "Enter",
			isComposing: keyboard.isComposing,
			key: "Enter",
		});
		Object.defineProperty(event, "keyCode", { value: keyboard.keyCode });
		element.dispatchEvent(event);
		return {
			defaultPrevented: event.defaultPrevented,
			isComposing: event.isComposing,
			keyCode: event.keyCode,
		};
	}, init);
}

test("composer yields IME Enter events before applying send shortcuts", async ({ page }) => {
	const sentPromptTexts = capturePromptTexts(page);
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	const userMessages = page.locator('[data-testid="chat-message"][data-role="user"]');
	await input.fill("ni hao ma");

	expect(await dispatchEnter(input, { isComposing: true, keyCode: ENTER_KEYCODE })).toEqual({
		defaultPrevented: false,
		isComposing: true,
		keyCode: ENTER_KEYCODE,
	});
	await expect(input).toHaveValue("ni hao ma");
	await expect(userMessages).toHaveCount(0);

	expect(await dispatchEnter(input, { isComposing: false, keyCode: IME_SENTINEL_KEYCODE })).toEqual(
		{
			defaultPrevented: false,
			isComposing: false,
			keyCode: IME_SENTINEL_KEYCODE,
		},
	);
	await expect(input).toHaveValue("ni hao ma");
	await expect(userMessages).toHaveCount(0);

	await input.fill("你好吗");
	expect(await dispatchEnter(input, { isComposing: false, keyCode: ENTER_KEYCODE })).toEqual({
		defaultPrevented: true,
		isComposing: false,
		keyCode: ENTER_KEYCODE,
	});
	await expect(input).toHaveValue("");
	await expect.poll(() => sentPromptTexts).toEqual(["你好吗"]);
});
