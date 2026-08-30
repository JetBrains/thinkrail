import { expect, test } from "@playwright/test";
import { hideAuxiliaryWorkbench, openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";

async function openChatAndSend(
	page: import("@playwright/test").Page,
	prompt: string,
): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

test("the reading band retains its runway and yields to reader intent", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openWorkspaceChat(page);
	await page.setViewportSize({ width: 1100, height: 800 });
	await hideAuxiliaryWorkbench(page);
	await page
		.getByTestId("chat-input")
		.fill(
			"First use the bash tool to run `sleep 8` exactly. After it finishes, list every integer " +
				"from 1 to 40, each as its own paragraph separated by a blank line, and nothing else.",
		);
	await page.getByTestId("chat-send").click();

	const chatScroll = page.getByTestId("chat-scroll");
	await expect(chatScroll).toHaveAttribute("data-latest-edge", "bottom");
	await expect(page.getByTestId("chat-stream-runway")).toBeVisible();
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	await expect(chatScroll).toHaveAttribute("data-streaming", "true");
	await expect(chatScroll).toHaveAttribute("data-streaming", "false", { timeout: 90_000 });

	const runway = page.getByTestId("chat-stream-runway");
	await expect(runway).toBeVisible();
	await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(chatScroll).toBeVisible();
	await expect
		.poll(() =>
			chatScroll.evaluate((root) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				const spacer = root.querySelector<HTMLElement>('[data-testid="chat-stream-runway"]');
				if (!scroller || !spacer) return Number.POSITIVE_INFINITY;
				return Math.abs(spacer.getBoundingClientRect().height - scroller.clientHeight * 0.42);
			}),
		)
		.toBeLessThanOrEqual(2);

	const scrollPoint = await chatScroll.evaluate((root) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 8) return null;
		const rect = scroller.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	});
	expect(
		scrollPoint,
		"chat content should overflow the transcript viewport so it can be scrolled",
	).not.toBeNull();
	if (!scrollPoint) return;
	await page.mouse.move(scrollPoint.x, scrollPoint.y);
	await page.mouse.wheel(0, -10_000);

	const latest = page.getByTestId("scroll-to-bottom");
	await expect(latest).toBeVisible();
	await expect(latest).toContainText("Latest");
	await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

	await latest.click();
	await expect(latest).toHaveCount(0);
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
});

test("the outer activity run reveals a thinking subtree that owns its following tools", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Reason step by step, use the bash tool to multiply 17 by 23, then give the answer.",
	);

	await waitForAgentSettled(page);

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
