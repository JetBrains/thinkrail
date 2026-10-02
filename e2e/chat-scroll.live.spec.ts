import { expect, test } from "@playwright/test";
import { hideAuxiliaryWorkbench, openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";
import { moveMouseToChatViewport, readChatScrollGeometry } from "./fixtures/chatScroll";

async function openChatAndSend(
	page: import("@playwright/test").Page,
	prompt: string,
): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

test("the reading band keeps a finished answer still when the agent settles", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openWorkspaceChat(page);
	await page.setViewportSize({ width: 1100, height: 800 });
	await hideAuxiliaryWorkbench(page);
	const statusSlot = page.getByTestId("chat-status-slot");
	const composer = page.getByTestId("chat-composer");
	await expect(statusSlot).toHaveAttribute("data-active", "false");
	const idleStatusHeight = (await statusSlot.boundingBox())?.height;
	const idleComposerTop = (await composer.boundingBox())?.y;
	await page
		.getByTestId("chat-input")
		.fill(
			"First use the bash tool to run `sleep 8` exactly. After it finishes, list every integer " +
				"from 1 to 40, each as its own paragraph separated by a blank line, and nothing else.",
		);
	await page.getByTestId("chat-send").click();

	const chatScroll = page.getByTestId("chat-scroll");
	await expect(chatScroll).toHaveAttribute("data-latest-edge", "bottom");
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	await expect(chatScroll).toHaveAttribute("data-streaming", "true");
	await expect(statusSlot).toHaveAttribute("data-active", "true");
	expect((await statusSlot.boundingBox())?.height).toBe(idleStatusHeight);
	expect((await composer.boundingBox())?.y).toBe(idleComposerTop);
	await expect(page.getByTestId("chat-stream-runway")).toHaveAttribute("data-active", "true");
	await chatScroll.evaluate((root) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller) throw new Error("missing Virtuoso scroller");
		const settled: Array<number | null> = [];
		let streamingTop: { id: string; top: number } | null = null;
		let reference: { id: string; top: number } | null = null;
		const topOf = (id: string) => {
			const row = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")].find(
				(candidate) => candidate.getAttribute("data-chat-row-id") === id,
			);
			return row ? row.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null;
		};
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			const viewportTop = scroller.getBoundingClientRect().top;
			if (root.getAttribute("data-streaming") === "true") {
				const row = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")].find(
					(candidate) => candidate.getBoundingClientRect().bottom > viewportTop + 1,
				);
				const id = row?.getAttribute("data-chat-row-id");
				streamingTop =
					row && id ? { id, top: row.getBoundingClientRect().top - viewportTop } : null;
			} else {
				reference ??= streamingTop;
				settled.push(reference ? topOf(reference.id) : null);
			}
			if (settled.length < 300) requestAnimationFrame(() => channel.port2.postMessage(0));
		};
		requestAnimationFrame(() => channel.port2.postMessage(0));
		(
			window as unknown as {
				__settleSamples: { reference: () => typeof reference; settled: typeof settled };
			}
		).__settleSamples = { reference: () => reference, settled };
	});
	await expect(chatScroll).toHaveAttribute("data-streaming", "false", { timeout: 90_000 });
	await page.waitForTimeout(1_500);

	await expect(statusSlot).toHaveAttribute("data-active", "false");
	expect((await statusSlot.boundingBox())?.height).toBe(idleStatusHeight);
	expect((await composer.boundingBox())?.y).toBe(idleComposerTop);
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	expect((await readChatScrollGeometry(chatScroll)).distanceFromEnd).toBeLessThanOrEqual(1);
	await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);
	const settlement = await page.evaluate(() => {
		const samples = (
			window as unknown as {
				__settleSamples: {
					reference: () => { id: string; top: number } | null;
					settled: Array<number | null>;
				};
			}
		).__settleSamples;
		return { reference: samples.reference(), settled: samples.settled };
	});
	expect(settlement.reference).not.toBeNull();
	expect(settlement.settled.length).toBeGreaterThan(20);
	for (const top of settlement.settled) {
		expect(top).not.toBeNull();
		expect((top ?? 0) - (settlement.reference?.top ?? 0)).toBeLessThanOrEqual(1);
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(chatScroll).toBeVisible();
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
});

test("a reader who scrolls away while the answer streams stays put when the agent settles", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openWorkspaceChat(page);
	await page.setViewportSize({ width: 1100, height: 800 });
	await hideAuxiliaryWorkbench(page);
	await page
		.getByTestId("chat-input")
		.fill(
			"List every integer from 1 to 300, each as its own paragraph separated by a blank line, and nothing else.",
		);
	await page.getByTestId("chat-send").click();

	const chatScroll = page.getByTestId("chat-scroll");
	await expect(chatScroll).toHaveAttribute("data-streaming", "true");
	await expect
		.poll(
			async () =>
				chatScroll.evaluate((root) => {
					const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
					if (!scroller) throw new Error("missing Virtuoso scroller");
					return scroller.scrollHeight > scroller.clientHeight + 300;
				}),
			{ timeout: 90_000 },
		)
		.toBe(true);

	await moveMouseToChatViewport(page, chatScroll);
	for (let notch = 0; notch < 4; notch += 1) {
		await page.mouse.wheel(0, -150);
		await page.waitForTimeout(40);
	}
	await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	await expect(chatScroll).toHaveAttribute("data-streaming", "true");
	const followButton = page.getByTestId("scroll-to-bottom");
	await expect(followButton).toContainText("Follow response");
	const anchor = await chatScroll.evaluate((root) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller) throw new Error("missing Virtuoso scroller");
		const viewport = scroller.getBoundingClientRect();
		const middle = viewport.top + viewport.height / 2;
		const row = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")].find((candidate) => {
			const rect = candidate.getBoundingClientRect();
			return rect.top <= middle && rect.bottom >= middle;
		});
		if (!row) throw new Error("no chat row intersects the viewport middle");
		const id = row.getAttribute("data-chat-row-id");
		if (!id) throw new Error("viewport row has no chat row id");
		return { id, top: row.getBoundingClientRect().top - viewport.top };
	});

	await expect(chatScroll).toHaveAttribute("data-streaming", "false", { timeout: 90_000 });
	await page.waitForTimeout(1_500);
	await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	await expect(followButton).toHaveText("Latest");
	const settledTop = await chatScroll.evaluate((root, rowId) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller) throw new Error("missing Virtuoso scroller");
		const row = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")].find(
			(candidate) => candidate.getAttribute("data-chat-row-id") === rowId,
		);
		if (!row) throw new Error(`chat row ${rowId} left the rendered transcript`);
		return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	}, anchor.id);
	expect(Math.abs(settledTop - anchor.top)).toBeLessThanOrEqual(2);
});

test("answering a question card while following keeps the text above it still", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);
	await page.setViewportSize({ width: 1100, height: 800 });
	await hideAuxiliaryWorkbench(page);
	await page
		.getByTestId("chat-input")
		.fill(
			"First write three short paragraphs about scrolling, then call the ask_user_question tool with " +
				"exactly one single-select question offering 4 options, each with a one-sentence description. " +
				"After I answer, reply with one short sentence.",
		);
	await page.getByTestId("chat-send").click();

	const chatScroll = page.getByTestId("chat-scroll");
	const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]').first();
	await expect(card).toBeVisible({ timeout: 90_000 });
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	await page.waitForTimeout(1_000);
	await chatScroll.evaluate((root) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		const cardRow = root
			.querySelector('[data-testid="ask-user-question"][data-tone="active"]')
			?.closest<HTMLElement>("[data-chat-row-id]");
		if (!scroller || !cardRow) throw new Error("missing scroller or question row");
		const rows = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")];
		const above = rows[rows.indexOf(cardRow) - 1];
		if (!above) throw new Error("no row above the question card");
		const id = above.getAttribute("data-chat-row-id");
		const samples: Array<{ submitted: boolean; top: number | null }> = [];
		const topOf = () => {
			const row = [...root.querySelectorAll<HTMLElement>("[data-chat-row-id]")].find(
				(candidate) => candidate.getAttribute("data-chat-row-id") === id,
			);
			return row ? row.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null;
		};
		const state = window as unknown as {
			__answerSamples: typeof samples;
			__answerSubmitted: boolean;
		};
		state.__answerSubmitted = false;
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			samples.push({ submitted: state.__answerSubmitted, top: topOf() });
			if (samples.length < 600) requestAnimationFrame(() => channel.port2.postMessage(0));
		};
		requestAnimationFrame(() => channel.port2.postMessage(0));
		state.__answerSamples = samples;
	});
	await card.getByTestId("ask-option").first().click();
	await page.evaluate(() => {
		(window as unknown as { __answerSubmitted: boolean }).__answerSubmitted = true;
	});
	await card.getByTestId("ask-submit").click();
	await expect(
		page.locator('[data-testid="ask-user-question"][data-tone="answered"]').first(),
	).toBeVisible({ timeout: 60_000 });
	await page.waitForTimeout(1_000);
	const samples = await page.evaluate(
		() =>
			(
				window as unknown as {
					__answerSamples: Array<{ submitted: boolean; top: number | null }>;
				}
			).__answerSamples,
	);
	const beforeSubmit = samples.filter((sample) => !sample.submitted).at(-1)?.top;
	const afterSubmit = samples.filter((sample) => sample.submitted);
	expect(beforeSubmit).not.toBeNull();
	expect(beforeSubmit).not.toBeUndefined();
	expect(afterSubmit.length).toBeGreaterThan(20);
	for (const sample of afterSubmit) {
		expect(sample.top).not.toBeNull();
		expect(Math.abs((sample.top ?? 0) - (beforeSubmit ?? 0))).toBeLessThanOrEqual(2);
	}
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
