import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

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

test("the outer activity run reveals a thinking subtree that owns its following tools", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Reason step by step, use the bash tool to multiply 17 by 23, then give the answer.",
	);

	await waitForDone(page);

	const activity = page.getByTestId("activity-group").filter({ hasText: "bash" }).first();
	await expect(activity).toBeVisible();
	await expect(activity).toHaveAttribute("data-expanded", "false");
	await activity.getByTestId("activity-group-toggle").click();

	const thinking = activity.getByTestId("thinking-group").filter({ hasText: "bash" }).first();
	await expect(thinking).toBeVisible();
	await expect(thinking).toHaveAttribute("data-expanded", "false");
	await thinking.getByTestId("thinking-group-toggle").click();

	await expect(thinking).toHaveAttribute("data-expanded", "true");
	await expect(thinking.getByTestId("thinking-group-text")).toBeVisible();
	await expect(thinking.locator('[data-testid="activity-step"][data-tool="bash"]')).toBeVisible();
});
