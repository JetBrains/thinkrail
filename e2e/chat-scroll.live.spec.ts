import { expect, test } from "@playwright/test";
import { expandAllActivityGroups, openWorkspaceChat, waitForDone } from "./fixtures/app";

async function openChatAndSend(
	page: import("@playwright/test").Page,
	prompt: string,
): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

test("jump button appears when scrolled up and returns to the latest on click", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1100, height: 360 });
	await openChatAndSend(
		page,
		"List every integer from 1 to 100, each as its own paragraph separated by a blank line, and nothing else.",
	);

	await waitForDone(page);

	await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);

	const scrolledUp = await page.getByTestId("chat-scroll").evaluate((root) => {
		const el = Array.from(root.querySelectorAll<HTMLElement>("*")).find(
			(e) => e.scrollHeight > e.clientHeight + 8,
		);
		if (!el) return false;
		el.scrollTop = 0;
		return true;
	});
	expect(scrolledUp, "chat content should overflow the short viewport so it can be scrolled").toBe(
		true,
	);

	await expect(page.getByTestId("scroll-to-bottom")).toBeVisible();

	await page.getByTestId("scroll-to-bottom").click();
	await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);
});

test("thinking folds into the activity run and its step reveals the text on click", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Reason step by step, then give the answer: what is 17 multiplied by 23?",
	);

	await waitForDone(page);
	await expandAllActivityGroups(page);

	const thinking = page.locator('[data-testid="activity-step"][data-step="thinking"]').first();
	await expect(thinking).toBeVisible();
	await expect(thinking).toHaveAttribute("data-expanded", "false");
	await expect(thinking).toContainText("chars");

	await thinking.getByTestId("activity-step-toggle").click();
	await expect(thinking).toHaveAttribute("data-expanded", "true");
});
