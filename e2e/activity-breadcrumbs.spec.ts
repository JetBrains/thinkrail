import { appendFileSync, realpathSync, utimesSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import {
	moveMouseToChatViewport,
	readChatScrollGeometry,
	readChatViewportCenterOffsets,
	readChatViewportIntersection,
} from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_400_000_000;
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);
const usage = {
	input: 10,
	output: 10,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 20,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function appendMessage(path: string, id: string, parentId: string, message: object): string {
	appendFileSync(
		path,
		`${JSON.stringify({
			type: "message",
			id,
			parentId,
			timestamp: new Date(BASE_TS).toISOString(),
			message,
		})}\n`,
	);
	return id;
}

async function selectMessageOrder(
	page: Page,
	order: "oldest-first" | "newest-first",
): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId(`chat-order-${order}`);
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
}

function seedNestedActivityChat(name: string) {
	const chat = seedWorkspaceSession(repoCwd(), {
		name,
		messages: [
			{ role: "user", text: "Record the earlier watcher investigation.", timestamp: BASE_TS },
			{
				role: "assistant",
				text: Array.from(
					{ length: 60 },
					(_, index) => `Historical watcher checkpoint ${index + 1} remained stable.`,
				).join("\n\n"),
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "user",
				text: Array.from(
					{ length: 24 },
					(_, index) => `Inspect sustained watcher churn scenario ${index + 1}.`,
				).join(" "),
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	const assistantId = `${chat.id}-a1`;
	appendMessage(chat.path, assistantId, `${chat.id}-m2`, {
		role: "assistant",
		content: [
			{ type: "toolCall", id: "read-prefix", name: "read", arguments: { path: "watch.ts" } },
			{ type: "thinking", thinking: "I should inspect the coalescer test next." },
			{ type: "toolCall", id: "read-nested", name: "read", arguments: { path: "watch.test.ts" } },
			{ type: "thinking", thinking: "The failing case needs a bounded max-wait assertion." },
			{
				type: "toolCall",
				id: "bash-long",
				name: "bash",
				arguments: { command: "bun test watch.test.ts" },
			},
		],
		usage,
		stopReason: "toolUse",
		timestamp: BASE_TS + 1_000,
	});
	let parentId = assistantId;
	for (const [toolCallId, toolName, output] of [
		["read-prefix", "read", "watcher source"],
		[
			"read-nested",
			"read",
			Array.from({ length: 60 }, (_, index) => `coalescer regression line ${index + 1}`).join("\n"),
		],
		[
			"bash-long",
			"bash",
			Array.from({ length: 120 }, (_, index) => `passing watcher assertion ${index + 1}`).join(
				"\n",
			),
		],
	] as const) {
		parentId = appendMessage(chat.path, `${chat.id}-${toolCallId}`, parentId, {
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text: output }],
			isError: false,
			timestamp: BASE_TS + 2_000,
		});
	}
	appendMessage(chat.path, `${chat.id}-a2`, parentId, {
		role: "assistant",
		content: [
			{
				type: "text",
				text: Array.from(
					{ length: 15 },
					(_, index) =>
						`The watcher checkpoint ${index + 1} now flushes within the bounded window.`,
				).join("\n\n"),
			},
		],
		usage,
		stopReason: "stop",
		timestamp: BASE_TS + 3_000,
	});
	utimesSync(chat.path, new Date(BASE_TS), new Date(BASE_TS));
	return chat;
}

test("a model-authored Thinking heading stays bounded and appears only while folded", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 780 });
	await openFixtureProject(page);
	const chat = seedWorkspaceSession(repoCwd(), {
		name: "thinking summary",
		messages: [{ role: "user", text: "Check the formatter output.", timestamp: BASE_TS }],
	});
	const assistantId = `${chat.id}-a1`;
	const toolNames = ["get_search_content", "fetch_content", "web_search", "spec_grep", "read"];
	appendMessage(chat.path, assistantId, `${chat.id}-m0`, {
		role: "assistant",
		content: [
			{
				type: "thinking",
				thinking:
					"**Evaluating formatting process**\n\nI should inspect the formatted file before continuing.",
			},
			...toolNames.map((name, index) => ({
				type: "toolCall",
				id: `summary-tool-${index}`,
				name,
				arguments: {},
			})),
		],
		usage,
		stopReason: "toolUse",
		timestamp: BASE_TS + 1_000,
	});
	let parentId = assistantId;
	for (const [index, toolName] of toolNames.entries()) {
		parentId = appendMessage(chat.path, `${chat.id}-summary-tool-${index}`, parentId, {
			role: "toolResult",
			toolCallId: `summary-tool-${index}`,
			toolName,
			content: [{ type: "text", text: "completed" }],
			isError: false,
			timestamp: BASE_TS + 2_000 + index,
		});
	}
	appendMessage(chat.path, `${chat.id}-a2`, parentId, {
		role: "assistant",
		content: [{ type: "text", text: "The formatter output is consistent." }],
		usage,
		stopReason: "stop",
		timestamp: BASE_TS + 3_000,
	});
	utimesSync(chat.path, new Date(BASE_TS), new Date(BASE_TS));

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const activity = page.getByTestId("activity-group").first();
	await activity.getByTestId("activity-group-toggle").click();
	const thinking = activity.getByTestId("thinking-group").first();
	const toggle = thinking.getByTestId("thinking-group-toggle");
	const heading = thinking.getByTestId("thinking-group-headline");
	const thinkingLabel = toggle.locator("span", { hasText: /^Thinking$/ });
	const metadata = "5 steps · get_search_content, fetch_content, web_search, spec_grep, +1 more";
	await expect(heading).toBeVisible();
	await expect(heading).toHaveText("Evaluating formatting process");
	await expect(heading).toHaveCSS("font-weight", "370");
	await expect(thinkingLabel).toHaveClass(/sr-only/);
	await expect(toggle).toContainText(metadata);

	await page.setViewportSize({ width: 390, height: 780 });
	await thinking.evaluate((element) => {
		element.style.width = "280px";
	});
	const layout = await toggle.evaluate((element, title) => {
		const metadataElement = [...element.querySelectorAll<HTMLElement>("span")].find(
			(candidate) => candidate.title === title,
		);
		const headingElement = element.querySelector<HTMLElement>(
			'[data-testid="thinking-group-headline"]',
		);
		if (!metadataElement || !headingElement)
			throw new Error("missing folded Thinking header parts");
		return {
			buttonClientWidth: element.clientWidth,
			buttonScrollWidth: element.scrollWidth,
			headingClientWidth: headingElement.clientWidth,
			metadataClientWidth: metadataElement.clientWidth,
			metadataScrollWidth: metadataElement.scrollWidth,
		};
	}, metadata);
	expect(layout.headingClientWidth).toBe(0);
	expect(layout.metadataClientWidth).toBeLessThan(layout.metadataScrollWidth);
	expect(layout.buttonScrollWidth).toBeLessThanOrEqual(layout.buttonClientWidth);

	await toggle.click();

	await expect(thinking).toHaveAttribute("data-expanded", "true");
	await expect(thinkingLabel).not.toHaveClass(/sr-only/);
	await expect(heading).toHaveCount(0);
	await expect(thinking.getByTestId("thinking-group-text")).toContainText(
		"**Evaluating formatting process**",
	);
});

for (const order of ["oldest-first", "newest-first"] as const) {
	test(`${order} disclosure expansion preserves following and detached reading anchors`, async ({
		page,
	}) => {
		test.setTimeout(60_000);
		await page.setViewportSize({ width: 1280, height: 720 });
		await openFixtureProject(page);
		seedNestedActivityChat(`${order} disclosure geometry`);
		await selectMessageOrder(page, order);
		await enterDefaultWorkspace(page);
		const chatScroll = page.getByTestId("chat-scroll");
		const button = page.getByTestId(
			order === "newest-first" ? "scroll-to-top" : "scroll-to-bottom",
		);
		const latestDistance = async () => {
			const geometry = await readChatScrollGeometry(chatScroll);
			return order === "newest-first" ? geometry.distanceFromStart : geometry.distanceFromEnd;
		};
		const expectFollowingLatest = async () => {
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await expect(button).toHaveCount(0);
			await expect.poll(latestDistance).toBeLessThanOrEqual(1);
			await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
			const maximumDistance = await chatScroll.evaluate(async (root, messageOrder) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				let maximum = 0;
				for (let frame = 0; frame < 32; frame += 1) {
					await new Promise(requestAnimationFrame);
					const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
					const distance =
						messageOrder === "newest-first"
							? scroller.scrollTop
							: maxScrollTop - scroller.scrollTop;
					maximum = Math.max(maximum, Math.abs(distance));
				}
				return maximum;
			}, order);
			expect(maximumDistance).toBeLessThanOrEqual(1);
		};
		await expectFollowingLatest();

		const messageToggle = page.getByTestId("user-message-toggle");
		await expect(messageToggle).toHaveAttribute("aria-expanded", "false");
		await messageToggle.click();
		await expect(messageToggle).toHaveAttribute("aria-expanded", "true");
		await expectFollowingLatest();
		await messageToggle.click();
		await expect(messageToggle).toHaveAttribute("aria-expanded", "false");
		await expectFollowingLatest();
		await messageToggle.click();
		await expect(messageToggle).toHaveAttribute("aria-expanded", "true");
		await expectFollowingLatest();
		const activity = page.getByTestId("activity-group").first();
		const activityToggle = activity.getByTestId("activity-group-toggle");
		await expect(activityToggle).toHaveAttribute("aria-expanded", "false");
		await activityToggle.focus();
		await page.keyboard.press("Enter");
		await expect(activityToggle).toHaveAttribute("aria-expanded", "true");
		await expectFollowingLatest();
		const thinking = activity.getByTestId("thinking-group").first();
		const thinkingToggle = thinking.getByTestId("thinking-group-toggle");
		await expect(thinkingToggle).toHaveAttribute("aria-expanded", "false");
		await thinkingToggle.click();
		await expect(thinkingToggle).toHaveAttribute("aria-expanded", "true");
		await expectFollowingLatest();
		const toolToggle = thinking
			.locator('[data-testid="activity-step"][data-tool="read"]')
			.getByTestId("activity-step-toggle");
		await expect(toolToggle).toHaveAttribute("aria-expanded", "false");
		await toolToggle.click();
		await expect(toolToggle).toHaveAttribute("aria-expanded", "true");
		await expectFollowingLatest();
		const longOutputToggle = thinking.getByTestId("collapsible-toggle");
		await expect(longOutputToggle).toHaveAttribute("aria-expanded", "false");
		await longOutputToggle.click();
		await expect(longOutputToggle).toHaveAttribute("aria-expanded", "true");
		await expectFollowingLatest();

		await moveMouseToChatViewport(page, chatScroll);
		const historyDelta = order === "newest-first" ? 160 : -160;
		await page.mouse.wheel(0, historyDelta);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await expect(button).toContainText("Latest");

		const placeToggleInViewport = async (toggle: Locator) => {
			await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
			for (let attempt = 0; attempt < 80; attempt += 1) {
				if ((await toggle.count()) > 0) {
					const intersection = await readChatViewportIntersection(toggle);
					if (intersection.intersectionHeight >= intersection.elementHeight - 1) return;
					await toggle.evaluate((element) => {
						const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
						if (!scroller) throw new Error("missing Virtuoso scroller");
						const target = element.getBoundingClientRect();
						const viewport = scroller.getBoundingClientRect();
						scroller.scrollTop +=
							target.top + target.height / 2 - (viewport.top + viewport.height / 2);
					});
				} else {
					await page.mouse.wheel(0, historyDelta);
				}
				await page.evaluate(() => new Promise(requestAnimationFrame));
			}
			throw new Error("fold toggle did not enter the chat viewport");
		};
		const maximumAnchorDeviation = (toggle: Locator, top: number) =>
			toggle.evaluate(async (element, expectedTop) => {
				let maximum = 0;
				for (let frame = 0; frame < 48; frame += 1) {
					await new Promise(requestAnimationFrame);
					maximum = Math.max(maximum, Math.abs(element.getBoundingClientRect().top - expectedTop));
				}
				return maximum;
			}, top);
		const expectDetachedToggleAnchor = async (
			toggle: Locator,
			activation: "keyboard" | "pointer" = "pointer",
		) => {
			await placeToggleInViewport(toggle);
			if (activation === "keyboard") await toggle.focus();
			const before = await toggle.boundingBox();
			expect(before).not.toBeNull();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			if (activation === "keyboard") await page.keyboard.press("Enter");
			else await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			expect(await maximumAnchorDeviation(toggle, before?.y ?? 0)).toBeLessThanOrEqual(2);
			await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await expect(button).toContainText("Latest");
			if (activation === "keyboard") await page.keyboard.press("Enter");
			else await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			expect(await maximumAnchorDeviation(toggle, before?.y ?? 0)).toBeLessThanOrEqual(2);
			await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		};

		await expectDetachedToggleAnchor(longOutputToggle);
		await expectDetachedToggleAnchor(toolToggle);
		await expectDetachedToggleAnchor(thinkingToggle, "keyboard");
		await expectDetachedToggleAnchor(activityToggle);
		await expectDetachedToggleAnchor(messageToggle);

		const retainedPreviewAnchor = page.getByText("coalescer regression line 5", { exact: true });
		await retainedPreviewAnchor.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			const target = element.getBoundingClientRect();
			const viewport = scroller.getBoundingClientRect();
			scroller.scrollTop += target.top + target.height / 2 - (viewport.top + viewport.height / 2);
		});
		await page.evaluate(() => new Promise(requestAnimationFrame));
		expect((await readChatViewportIntersection(longOutputToggle)).intersects).toBe(false);
		const retainedPreviewTop = (await retainedPreviewAnchor.boundingBox())?.y;
		expect(retainedPreviewTop).toBeDefined();
		await longOutputToggle.evaluate((element) => element.click());
		await expect(longOutputToggle).toHaveAttribute("aria-expanded", "false");
		expect(
			await maximumAnchorDeviation(retainedPreviewAnchor, retainedPreviewTop ?? 0),
		).toBeLessThanOrEqual(2);
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		await longOutputToggle.evaluate((element) => element.click());
		await expect(longOutputToggle).toHaveAttribute("aria-expanded", "true");
		expect(
			await maximumAnchorDeviation(retainedPreviewAnchor, retainedPreviewTop ?? 0),
		).toBeLessThanOrEqual(2);
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");

		const clippedPreviewAnchor = page.getByText("coalescer regression line 30", { exact: true });
		await clippedPreviewAnchor.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			const target = element.getBoundingClientRect();
			const viewport = scroller.getBoundingClientRect();
			scroller.scrollTop += target.top + target.height / 2 - (viewport.top + viewport.height / 2);
		});
		await page.evaluate(() => new Promise(requestAnimationFrame));
		expect((await readChatViewportIntersection(longOutputToggle)).intersects).toBe(false);
		await longOutputToggle.evaluate((element) => element.click());
		await expect(longOutputToggle).toHaveAttribute("aria-expanded", "false");
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		const collapsedOutputBoundary = await longOutputToggle.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			return scroller.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
		});
		expect(Math.abs(collapsedOutputBoundary)).toBeLessThanOrEqual(2);
		await longOutputToggle.click();
		await expect(longOutputToggle).toHaveAttribute("aria-expanded", "true");
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");

		const offscreenAnchor = page.getByText(
			order === "newest-first"
				? "Historical watcher checkpoint 8 remained stable."
				: "The watcher checkpoint 8 now flushes within the bounded window.",
			{ exact: true },
		);
		for (let attempt = 0; attempt < 80 && (await offscreenAnchor.count()) === 0; attempt += 1) {
			await page.mouse.wheel(0, 160);
			await page.evaluate(() => new Promise(requestAnimationFrame));
		}
		await expect(offscreenAnchor).toHaveCount(1);
		await offscreenAnchor.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			const target = element.getBoundingClientRect();
			const viewport = scroller.getBoundingClientRect();
			scroller.scrollTop += target.top + target.height / 2 - (viewport.top + viewport.height / 2);
		});
		await page.evaluate(() => new Promise(requestAnimationFrame));
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await expect(activityToggle).toHaveCount(1);
		expect((await readChatViewportIntersection(activityToggle)).intersects).toBe(false);
		const anchorTop = (await offscreenAnchor.boundingBox())?.y;
		expect(anchorTop).toBeDefined();
		await activityToggle.evaluate((element) => element.click());
		await expect(activityToggle).toHaveAttribute("aria-expanded", "false");
		expect(await maximumAnchorDeviation(offscreenAnchor, anchorTop ?? 0)).toBeLessThanOrEqual(2);
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		expect((await readChatViewportIntersection(activityToggle)).intersects).toBe(false);
		await activityToggle.evaluate((element) => element.click());
		await expect(activityToggle).toHaveAttribute("aria-expanded", "true");
		expect(await maximumAnchorDeviation(offscreenAnchor, anchorTop ?? 0)).toBeLessThanOrEqual(2);
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

		await thinkingToggle.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			const target = element.getBoundingClientRect();
			const viewport = scroller.getBoundingClientRect();
			scroller.scrollTop += target.top - viewport.top - 20;
		});
		await page.evaluate(() => new Promise(requestAnimationFrame));
		const trail = page.getByTestId("activity-breadcrumb-trail");
		await expect(trail).toBeVisible();
		const parentBreadcrumbHeight = (await trail.boundingBox())?.height ?? 0;
		const partiallyCoveredOffset = await thinkingToggle.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		});
		expect(partiallyCoveredOffset).toBeGreaterThan(0);
		expect(partiallyCoveredOffset).toBeLessThan(parentBreadcrumbHeight);
		await trail
			.locator('[data-testid="activity-breadcrumb-segment"][data-kind="thinking"]')
			.locator("button")
			.first()
			.click();
		await expect(thinkingToggle).toHaveAttribute("aria-expanded", "false");
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		const nestedHeaderOffset = await thinkingToggle.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		});
		expect(Math.abs(nestedHeaderOffset - parentBreadcrumbHeight)).toBeLessThanOrEqual(2);
		await thinkingToggle.evaluate((element) => element.click());
		await expect(thinkingToggle).toHaveAttribute("aria-expanded", "true");
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		const activityContent = page.getByText("coalescer regression line 30", { exact: true });
		await activityContent.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			const target = element.getBoundingClientRect();
			const viewport = scroller.getBoundingClientRect();
			scroller.scrollTop += target.top + target.height / 2 - (viewport.top + viewport.height / 2);
		});
		await page.evaluate(() => new Promise(requestAnimationFrame));
		await expect(trail).toBeVisible();
		await trail
			.locator('[data-testid="activity-breadcrumb-segment"][data-kind="activity"]')
			.locator("button")
			.first()
			.click();
		await expect(activityToggle).toHaveAttribute("aria-expanded", "false");
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		const collapsedHeaderOffset = await activityToggle.evaluate((element) => {
			const scroller = element.closest<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) throw new Error("missing Virtuoso scroller");
			return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		});
		expect(Math.abs(collapsedHeaderOffset)).toBeLessThanOrEqual(2);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await expect(button).toContainText("Latest");

		await activityToggle.click();
		await expect(activityToggle).toHaveAttribute("aria-expanded", "true");
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		await button.click();
		await expectFollowingLatest();
		await page.getByTestId("chat-input").press("Control+r");
		const history = page.getByTestId("history-overlay");
		await expect(history).toBeVisible();
		const historyQuery = page.getByTestId("history-query");
		await historyQuery.fill("Historical watcher checkpoint 30 remained stable");
		await expect(page.getByTestId("history-expand-hint")).toBeVisible();
		await historyQuery.press("Tab");
		const historyHit = page.locator('[data-testid="history-item"][data-kind="message"]');
		await expect(historyHit).toHaveCount(1);
		await expect(historyHit).toBeVisible();
		await historyQuery.press("Enter");
		await expect(history).toBeHidden();
		const flashedHistoryRow = page.locator("[data-flash]");
		await expect(flashedHistoryRow).toBeVisible();
		await expect(flashedHistoryRow).toContainText(
			"Historical watcher checkpoint 30 remained stable",
		);
		await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
		const exactHistoryAnchor = page.getByText("Historical watcher checkpoint 30 remained stable.", {
			exact: true,
		});
		await expect(exactHistoryAnchor).toBeAttached();
		expect((await readChatViewportIntersection(exactHistoryAnchor)).intersects).toBe(true);
		const historyCenterOffsets = await readChatViewportCenterOffsets(exactHistoryAnchor);
		expect(historyCenterOffsets.every((offset) => Math.abs(offset) <= 80)).toBe(true);
		expect(
			Math.max(...historyCenterOffsets) - Math.min(...historyCenterOffsets),
		).toBeLessThanOrEqual(1);
	});
}

test("sticky activity breadcrumbs expose the off-screen Activity → Thinking → tool path", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedNestedActivityChat("sticky activity");

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const chatScroll = page.getByTestId("chat-scroll");
	const assertFollowingLatest = async () => {
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);
		await expect
			.poll(async () => (await readChatScrollGeometry(chatScroll)).distanceFromEnd)
			.toBeLessThanOrEqual(1);
	};
	await assertFollowingLatest();

	const activity = page.getByTestId("activity-group").first();
	await activity.getByTestId("activity-group-toggle").click();
	await assertFollowingLatest();
	const thinking = activity.getByTestId("thinking-group").last();
	await thinking.getByTestId("thinking-group-toggle").click();
	await assertFollowingLatest();
	const tool = thinking.locator('[data-testid="activity-step"][data-tool="bash"]');
	await tool.getByTestId("activity-step-toggle").click();
	await assertFollowingLatest();

	const trail = page.getByTestId("activity-breadcrumb-trail");
	await expect
		.poll(async () => {
			await tool.evaluate((element) => {
				const scroller = element.closest<HTMLElement>('[data-virtuoso-scroller="true"]');
				if (!scroller) throw new Error("missing Virtuoso scroller");
				scroller.scrollTop +=
					element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 80;
			});
			return trail.count();
		})
		.toBe(1);
	await expect(trail).toBeVisible();
	await expect(trail.getByTestId("activity-breadcrumb-segment")).toHaveCount(3);
	await expect(trail.locator('[data-kind="activity"]')).toBeVisible();
	await expect(trail.locator('[data-kind="thinking"]')).toBeVisible();
	await expect(trail.locator('[data-kind="tool"]')).toContainText("bash");

	await trail.getByRole("button", { name: "Jump to Thinking" }).click();
	await expect(thinking.getByTestId("thinking-group-toggle")).toBeFocused();
});
