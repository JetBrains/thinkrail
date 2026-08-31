import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expandActivityStep, openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

async function expandToolStep(page: Page, tool: string): Promise<Locator> {
	await waitForAgentSettled(page);
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

test("web_search renders its query and terminal result", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Call the web_search tool exactly once with the query 'capital of France'. If it errors, do not retry. Then stop.",
	);
	const step = await expandToolStep(page, "web_search");
	const body = step.getByTestId("tool-web_search");
	await expect(body).toBeVisible();
	await expect(body).toContainText("capital of France");
	await expect(body).not.toContainText("Searching…");
});
