import { expect, test } from "bun:test";
import { DOUBLE_CLICK_SETTLE_MS } from "../../lib";
import { type AuxiliaryView, scheduleReviewReveal } from "./legacySelection";

const WINDOW_MS = 30;

function auxiliary(initial: AuxiliaryView) {
	let view = initial;
	return {
		read: () => view,
		set: (next: AuxiliaryView) => {
			view = next;
		},
	};
}

const specsShowing = { reviewShowing: false, showingKey: "specs" };

function afterWindow(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, WINDOW_MS + 1));
}

test("scheduleReviewReveal reveals at once when no double-click can arrive", () => {
	let reveals = 0;
	const cancel = scheduleReviewReveal(
		() => {
			reveals += 1;
		},
		auxiliary(specsShowing).read,
		0,
	);
	expect(reveals).toBe(1);
	expect(cancel).toBeUndefined();
});

test("scheduleReviewReveal waits out a browse row's double-click window", async () => {
	let reveals = 0;
	scheduleReviewReveal(
		() => {
			reveals += 1;
		},
		auxiliary(specsShowing).read,
		WINDOW_MS,
	);
	expect(reveals).toBe(0);
	await afterWindow();
	expect(reveals).toBe(1);
});

test("scheduleReviewReveal cleanup cancels a pending reveal", async () => {
	let reveals = 0;
	const cancel = scheduleReviewReveal(
		() => {
			reveals += 1;
		},
		auxiliary(specsShowing).read,
		WINDOW_MS,
	);
	cancel?.();
	await afterWindow();
	expect(reveals).toBe(0);
});

test("a deferred reveal yields to an auxiliary tool the user picked inside the window", async () => {
	const view = auxiliary({ reviewShowing: false, showingKey: "files" });
	let reveals = 0;
	scheduleReviewReveal(
		() => {
			reveals += 1;
		},
		view.read,
		WINDOW_MS,
	);
	view.set(specsShowing);
	await afterWindow();
	expect(reveals).toBe(0);
});

test("scheduleReviewReveal reveals at once when Review already shows, even mid double-click", () => {
	let reveals = 0;
	const cancel = scheduleReviewReveal(
		() => {
			reveals += 1;
		},
		auxiliary({ reviewShowing: true, showingKey: "review" }).read,
		DOUBLE_CLICK_SETTLE_MS,
	);
	expect(reveals).toBe(1);
	expect(cancel).toBeUndefined();
});
