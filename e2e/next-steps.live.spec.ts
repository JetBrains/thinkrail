import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

const REQUEST = [
	"In one short sentence, say what a mutex is.",
	"Then call the offer_next_steps tool exactly once, offering two ways I could continue.",
	"Give each item a label of at most four words and a prompt that is a full sentence,",
	"clearly longer than its own label. Use no other tools.",
].join(" ");

const sentPrompts = new WeakMap<Page, string[]>();

function promptText(payload: string | Buffer): string | null {
	try {
		const frame = JSON.parse(typeof payload === "string" ? payload : payload.toString()) as {
			method?: unknown;
			params?: { text?: unknown };
		};
		return frame.method === "session.prompt" && typeof frame.params?.text === "string"
			? frame.params.text
			: null;
	} catch {
		return null;
	}
}

test.beforeEach(({ page }) => {
	const prompts: string[] = [];
	sentPrompts.set(page, prompts);
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			const text = promptText(payload);
			if (text !== null) prompts.push(text);
		});
	});
});

test("a real agent's offer reaches the composer as chips and a chip sends that item's whole prompt", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(REQUEST);
	await page.getByTestId("chat-send").click();
	await waitForDone(page, 150_000);

	const row = page.getByTestId("next-steps");
	await expect(row).toBeVisible({ timeout: 30_000 });
	await expect(
		page.locator('[data-testid="activity-step"][data-tool="offer_next_steps"]'),
	).toHaveCount(0);

	const chips = page.getByTestId("next-step-chip");
	const count = await chips.count();
	expect(count).toBeGreaterThanOrEqual(1);
	expect(count).toBeLessThanOrEqual(3);
	await expect(row).toHaveAttribute("data-count", String(count));

	const label = ((await chips.nth(0).textContent()) ?? "").trim();
	expect(label.length).toBeGreaterThan(0);

	const before = sentPrompts.get(page)?.length ?? 0;
	await chips.nth(0).click();

	await expect
		.poll(() => (sentPrompts.get(page)?.length ?? 0) - before, { timeout: 15_000 })
		.toBe(1);
	const sent = sentPrompts.get(page)?.[before] ?? "";
	expect(sent.length).toBeGreaterThan(label.length);

	await expect(row).toHaveCount(0);
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]').last()).toContainText(
		sent,
	);
	await expect(page.getByTestId("chat-input")).toHaveValue("");

	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toHaveCount(2, { timeout: 150_000 });
});
