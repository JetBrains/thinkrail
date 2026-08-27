import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

const REQUEST =
	"Explain what a mutex is in one sentence, then suggest two useful ways I could explore the topic further.";

interface ObservedFrames {
	prompts: string[];
	settlements: number;
}

const observedFrames = new WeakMap<Page, ObservedFrames>();

function parsedFrame(payload: string | Buffer): {
	method?: unknown;
	params?: { text?: unknown };
	channel?: unknown;
	data?: { event?: { type?: unknown } };
} | null {
	try {
		return JSON.parse(typeof payload === "string" ? payload : payload.toString());
	} catch {
		return null;
	}
}

test.beforeEach(({ page }) => {
	const observed: ObservedFrames = { prompts: [], settlements: 0 };
	observedFrames.set(page, observed);
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			const frame = parsedFrame(payload);
			if (frame?.method === "session.prompt" && typeof frame.params?.text === "string") {
				observed.prompts.push(frame.params.text);
			}
		});
		socket.on("framereceived", ({ payload }) => {
			const frame = parsedFrame(payload);
			if (frame?.channel === "pi.event" && frame.data?.event?.type === "agent_settled") {
				observed.settlements++;
			}
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

	const observed = observedFrames.get(page);
	const promptsBefore = observed?.prompts.length ?? 0;
	const settlementsBefore = observed?.settlements ?? 0;
	await chips.nth(0).click();

	await expect
		.poll(() => (observed?.prompts.length ?? 0) - promptsBefore, { timeout: 15_000 })
		.toBe(1);
	const sent = observed?.prompts[promptsBefore] ?? "";
	expect(sent.length).toBeGreaterThan(label.length);

	await expect(row).toHaveCount(0);
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]').last()).toContainText(
		sent,
	);
	await expect(page.getByTestId("chat-input")).toHaveValue("");

	await expect
		.poll(() => (observed?.settlements ?? 0) - settlementsBefore, { timeout: 150_000 })
		.toBe(1);
});
