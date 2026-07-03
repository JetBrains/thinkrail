import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to produce a conversation tall enough
// to scroll. Covers the pointer-aware auto-scroll (Task 7) — the floating jump button and that scrolling
// up suppresses the snap-to-bottom.

/** Open a workspace chat and send `prompt`. */
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
	// Short viewport + a long list → the conversation overflows by a wide margin regardless of the exact
	// reply length, so the test never depends on the model producing a precise number of lines. Blank-line
	// separation matters: the chat renders markdown, which collapses single newlines into spaces — plain
	// "one per line" output can flatten into a single short paragraph too small to scroll.
	await page.setViewportSize({ width: 1100, height: 360 });
	await openChatAndSend(
		page,
		"List every integer from 1 to 100, each as its own paragraph separated by a blank line, and nothing else.",
	);

	// Wait for the turn to complete so the content height is stable before we scroll.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 90_000 });

	// Pinned to the bottom after streaming → no jump button.
	await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);

	// Scroll the chat list up to the top (deterministic — fires the scroller's scroll event, which Virtuoso
	// reports as "not at bottom"). The Virtuoso scroller is the overflowing descendant of the wrapper.
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

	// The jump button appears once we're off the bottom.
	await expect(page.getByTestId("scroll-to-bottom")).toBeVisible();

	// Clicking it returns to the latest message and hides the button.
	await page.getByTestId("scroll-to-bottom").click();
	await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);
});

// Best-effort @agent: the e2e agent dir pins thinking level "low", so a reasoning prompt emits a
// thinking block. Covers Task 8 — it auto-collapses once the answer arrives and reopens on click.
test("thinking block auto-collapses after the answer and reopens on click", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Reason step by step, then give the answer: what is 17 multiplied by 23?",
	);

	const thinking = page.getByTestId("thinking-block").first();
	await expect(thinking).toBeVisible({ timeout: 90_000 });

	// Once the turn completes the answer text exists, so the block auto-collapsed (user never toggled it),
	// showing its character count.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 90_000 });
	await expect(thinking).toHaveAttribute("data-expanded", "false");
	await expect(thinking).toContainText("chars");

	// The user can reopen it; their manual choice sticks.
	await thinking.locator("button").click();
	await expect(thinking).toHaveAttribute("data-expanded", "true");
});
