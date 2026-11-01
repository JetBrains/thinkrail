import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat, pressPlatformShortcut } from "./fixtures/app";

type PromptFrame = {
	method?: string;
	params?: { sessionId?: string; text?: string };
};

function capturePrompts(page: Page): PromptFrame[] {
	const prompts: PromptFrame[] = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			try {
				const frame = JSON.parse(
					typeof payload === "string" ? payload : payload.toString(),
				) as PromptFrame;
				if (frame.method === "session.prompt" || frame.method === "session.steer") {
					prompts.push(frame);
				}
			} catch {}
		});
	});
	return prompts;
}

test("one full-width composer sends Enter left and Ctrl+Enter right", async ({ page }) => {
	const prompts = capturePrompts(page);
	await openWorkspaceChat(page);
	await page.getByTestId("split-chat").click();

	const split = page.getByTestId("split-chat-view");
	await expect(split).toBeVisible();
	const chats = split.getByTestId("chat-view");
	await expect(chats).toHaveCount(2);
	await expect(split.getByTestId("chat-composer")).toHaveCount(1);
	const leftId = await chats.nth(0).getAttribute("data-session-id");
	const rightId = await chats.nth(1).getAttribute("data-session-id");
	expect(leftId).toBeTruthy();
	expect(rightId).toBeTruthy();
	expect(rightId).not.toBe(leftId);

	const left = await chats.nth(0).boundingBox();
	const right = await chats.nth(1).boundingBox();
	const footer = await split.getByTestId("chat-composer").boundingBox();
	expect(left && right && footer).toBeTruthy();
	if (!left || !right || !footer) return;
	expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(2);
	expect(footer.x).toBeLessThanOrEqual(left.x + 2);
	expect(footer.x + footer.width).toBeGreaterThanOrEqual(right.x + right.width - 2);
	expect(footer.y).toBeGreaterThanOrEqual(left.y + left.height - 2);

	const input = split.getByTestId("chat-input");
	await input.fill("left prompt");
	await input.press("Enter");
	await expect
		.poll(() => prompts.find((frame) => frame.params?.text === "left prompt"))
		.toMatchObject({
			method: "session.prompt",
			params: { sessionId: leftId },
		});

	await input.fill("right prompt");
	await pressPlatformShortcut(page, "Enter");
	await expect
		.poll(() => prompts.find((frame) => frame.params?.text === "right prompt"))
		.toMatchObject({
			method: "session.prompt",
			params: { sessionId: rightId },
		});

	await chats.nth(0).getByTestId("split-chat").click();
	await expect(split).toHaveCount(0);
	await expect(page.getByTestId("chat-view")).toHaveCount(1);
});
