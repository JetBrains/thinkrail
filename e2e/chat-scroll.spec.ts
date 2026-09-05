import { realpathSync, rmSync, utimesSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { moveMouseToChatViewport, readChatScrollGeometry } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_850_000_000;

type MessageOrder = "oldest-first" | "newest-first";

const orderCases: Array<{
	order: MessageOrder;
	buttonTestId: "scroll-to-bottom" | "scroll-to-top";
	outwardWheel: number;
	historyWheel: number;
	latestWheel: number;
}> = [
	{
		order: "oldest-first",
		buttonTestId: "scroll-to-bottom",
		outwardWheel: 120,
		historyWheel: -900,
		latestWheel: 900,
	},
	{
		order: "newest-first",
		buttonTestId: "scroll-to-top",
		outwardWheel: -120,
		historyWheel: 900,
		latestWheel: -900,
	},
];

async function selectMessageOrder(page: Page, order: MessageOrder): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId(`chat-order-${order}`);
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
}

function seedTallChat(name: string) {
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: Array.from({ length: 40 }, (_, index) => [
			{
				role: "user" as const,
				text: `request ${index + 1}: inspect the deterministic scrolling fixture`,
				timestamp: BASE_TS + index * 2_000,
			},
			{
				role: "assistant" as const,
				text: `answer ${index + 1}: the deterministic scrolling fixture is complete`,
				timestamp: BASE_TS + index * 2_000 + 1_000,
			},
		]).flat(),
	});
	utimesSync(session.path, new Date(BASE_TS + 100_000), new Date(BASE_TS + 100_000));
	return session;
}

async function openTallChat(page: Page, order: MessageOrder) {
	await openFixtureProject(page);
	const session = seedTallChat(`${order} deterministic scrolling`);
	await selectMessageOrder(page, order);
	await enterDefaultWorkspace(page);
	const chatScroll = page.getByTestId("chat-scroll");
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	await expect
		.poll(async () => {
			const geometry = await readChatScrollGeometry(chatScroll);
			return order === "newest-first" ? geometry.distanceFromStart : geometry.distanceFromEnd;
		})
		.toBeLessThanOrEqual(1);
	return { session, chatScroll };
}

for (const testCase of orderCases) {
	test(`${testCase.order} ignores repeated outward wheel input at the physical latest edge`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		try {
			await moveMouseToChatViewport(page, chatScroll);
			for (let tick = 0; tick < 4; tick += 1) {
				await page.mouse.wheel(0, testCase.outwardWheel);
				await page.evaluate(() => new Promise(requestAnimationFrame));
				await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
				await expect(page.getByTestId(testCase.buttonTestId)).toHaveCount(0);
			}
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} rearms only when a latest-directed wheel reaches the physical edge`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		try {
			await moveMouseToChatViewport(page, chatScroll);
			await page.mouse.wheel(0, testCase.historyWheel);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

			await chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.scrollTop = order === "newest-first" ? 25 : maxScrollTop - 25;
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

			await moveMouseToChatViewport(page, chatScroll);
			await page.mouse.wheel(0, testCase.latestWheel > 0 ? 4 : -4);
			const near = await readChatScrollGeometry(chatScroll);
			const nearDistance =
				testCase.order === "newest-first" ? near.distanceFromStart : near.distanceFromEnd;
			expect(nearDistance).toBeGreaterThan(1);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

			await page.mouse.wheel(0, testCase.latestWheel);
			await expect
				.poll(async () => {
					const geometry = await readChatScrollGeometry(chatScroll);
					return testCase.order === "newest-first"
						? geometry.distanceFromStart
						: geometry.distanceFromEnd;
				})
				.toBeLessThanOrEqual(1);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await expect(page.getByTestId(testCase.buttonTestId)).toHaveCount(0);
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} keeps an idle status slot at the logical latest edge`, async ({ page }) => {
		const { session } = await openTallChat(page, testCase.order);
		try {
			const slot = page.getByTestId("chat-status-slot");
			await expect(slot).toHaveCount(1);
			await expect(slot).toHaveAttribute("data-active", "false");
			expect((await slot.boundingBox())?.height).toBeGreaterThan(0);
			await expect(page.getByTestId("stream-indicator")).toHaveCount(0);
		} finally {
			rmSync(session.path, { force: true });
		}
	});
}
