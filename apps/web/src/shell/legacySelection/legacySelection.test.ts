import { expect, test } from "bun:test";
import { DOUBLE_CLICK_SETTLE_MS, firstClickOnly } from "../../lib";
import { scheduleReviewReveal } from "./legacySelection";

test("scheduleReviewReveal reveals at once when no double-click can arrive", async () => {
	await Bun.sleep(DOUBLE_CLICK_SETTLE_MS);
	let reveals = 0;
	const cancel = scheduleReviewReveal(() => {
		reveals += 1;
	});
	expect(reveals).toBe(1);
	expect(cancel).toBeUndefined();
});

test("scheduleReviewReveal waits out a browse row's double-click window", async () => {
	firstClickOnly(() => {})({ detail: 1 });
	let reveals = 0;
	scheduleReviewReveal(() => {
		reveals += 1;
	});
	expect(reveals).toBe(0);
	await Bun.sleep(DOUBLE_CLICK_SETTLE_MS + 20);
	expect(reveals).toBe(1);
});

test("scheduleReviewReveal cleanup cancels a pending reveal", async () => {
	firstClickOnly(() => {})({ detail: 1 });
	let reveals = 0;
	const cancel = scheduleReviewReveal(() => {
		reveals += 1;
	});
	cancel?.();
	await Bun.sleep(DOUBLE_CLICK_SETTLE_MS + 20);
	expect(reveals).toBe(0);
});
