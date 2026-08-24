import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expandActivityStep, openWorkspaceChat, waitForDone } from "./fixtures/app";

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

async function expandToolStep(page: Page, tool: string): Promise<Locator> {
	await waitForDone(page);
	return expandActivityStep(page, tool);
}

test("fetch_content is invoked and rendered by our card", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Use the fetch_content tool to fetch https://example.com — use only that tool — then report the page title.",
	);
	const step = await expandToolStep(page, "fetch_content");
	await expect(step.getByTestId("tool-fetch_content")).toBeVisible();
});

test("web_search renders a card with a real answer", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the web_search tool to find the capital of France, then state it. Use only that tool.",
	);
	const step = await expandToolStep(page, "web_search");
	const body = step.getByTestId("tool-web_search");
	await expect(body).toBeVisible();
	await expect(body).toContainText("Paris", { timeout: 120_000 });
});
