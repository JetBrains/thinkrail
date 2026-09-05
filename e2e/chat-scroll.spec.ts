import { realpathSync, rmSync, utimesSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { moveMouseToChatViewport, readChatScrollGeometry } from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_850_000_000;
const NATIVE_SCROLL_INTENT_EXPIRY_MS = 650;

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

async function waitForScrollStability(chatScroll: Locator): Promise<void> {
	await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
	await chatScroll.evaluate(async (root) => {
		const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
		if (!scroller) throw new Error("missing Virtuoso scroller");
		let previousTop = scroller.scrollTop;
		let previousHeight = scroller.scrollHeight;
		let stableFrames = 0;
		for (let frame = 0; frame < 120; frame += 1) {
			await new Promise(requestAnimationFrame);
			const currentTop = scroller.scrollTop;
			const currentHeight = scroller.scrollHeight;
			stableFrames =
				Math.abs(currentTop - previousTop) <= 0.5 && Math.abs(currentHeight - previousHeight) <= 0.5
					? stableFrames + 1
					: 0;
			if (stableFrames >= 4) return;
			previousTop = currentTop;
			previousHeight = currentHeight;
		}
		throw new Error("chat scroll did not stabilize");
	});
	await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
}

function latestDistance(
	order: MessageOrder,
	geometry: Awaited<ReturnType<typeof readChatScrollGeometry>>,
) {
	return order === "newest-first" ? geometry.distanceFromStart : geometry.distanceFromEnd;
}

async function moveIntoStableHistory(
	page: Page,
	chatScroll: Locator,
	order: MessageOrder,
	historyWheel: number,
) {
	await moveMouseToChatViewport(page, chatScroll);
	for (let attempt = 0; attempt < 8; attempt += 1) {
		await page.mouse.wheel(0, historyWheel);
		await waitForScrollStability(chatScroll);
		const geometry = await readChatScrollGeometry(chatScroll);
		if (latestDistance(order, geometry) > 100) return geometry;
	}
	throw new Error("chat did not remain positioned in history");
}

async function openTallChat(page: Page, order: MessageOrder) {
	await openFixtureProject(page);
	const session = seedTallChat(`${order} deterministic scrolling`);
	await selectMessageOrder(page, order);
	await enterDefaultWorkspace(page);
	const chatScroll = page.getByTestId("chat-scroll");
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
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

	test(`${testCase.order} does not strand following after a no-op native gesture`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		try {
			await chatScroll.evaluate(
				(root, { order, historyWheel }) => {
					const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
					if (!scroller) throw new Error("missing Virtuoso scroller");
					scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: historyWheel }));
					const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
					scroller.scrollTop =
						order === "newest-first"
							? Math.max(0, maxScrollTop - 300)
							: Math.min(300, maxScrollTop);
					scroller.dispatchEvent(new Event("scroll"));
				},
				{ order: testCase.order, historyWheel: testCase.historyWheel },
			);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await chatScroll.evaluate(
				(root, { buttonTestId, historyWheel }) => {
					const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
					const latest = root.querySelector<HTMLButtonElement>(`[data-testid="${buttonTestId}"]`);
					if (!scroller || !latest) throw new Error("missing chat scroll controls");
					latest.click();
					scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: historyWheel }));
				},
				{ buttonTestId: testCase.buttonTestId, historyWheel: testCase.historyWheel },
			);
			await waitForScrollStability(chatScroll);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			expect(
				latestDistance(testCase.order, await readChatScrollGeometry(chatScroll)),
			).toBeLessThanOrEqual(1);
			await expect(page.getByTestId(testCase.buttonTestId)).toHaveCount(0);
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} pauses an active return while a scrollbar pointer is held`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		try {
			await moveIntoStableHistory(page, chatScroll, testCase.order, testCase.historyWheel);
			await chatScroll.evaluate(
				(root, { buttonTestId }) => {
					const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
					const latest = root.querySelector<HTMLButtonElement>(`[data-testid="${buttonTestId}"]`);
					if (!scroller || !latest) throw new Error("missing chat scroll controls");
					latest.click();
					scroller.dispatchEvent(
						new PointerEvent("pointerdown", {
							bubbles: true,
							isPrimary: true,
							pointerId: 64,
							pointerType: "mouse",
						}),
					);
				},
				{ buttonTestId: testCase.buttonTestId },
			);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
			const heldDrift = await chatScroll.evaluate(async (root) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				const start = scroller.scrollTop;
				for (let frame = 0; frame < 4; frame += 1) await new Promise(requestAnimationFrame);
				return Math.abs(scroller.scrollTop - start);
			});
			expect(heldDrift).toBeLessThanOrEqual(1);
			await chatScroll.locator("[data-virtuoso-scroller]").dispatchEvent("pointerup", {
				isPrimary: true,
				pointerId: 64,
				pointerType: "mouse",
			});
			await waitForScrollStability(chatScroll);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			expect(
				latestDistance(testCase.order, await readChatScrollGeometry(chatScroll)),
			).toBeLessThanOrEqual(1);
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
			await waitForScrollStability(chatScroll);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

			await chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.scrollTop = order === "newest-first" ? 25 : maxScrollTop - 25;
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			const positionedNearLatest = await readChatScrollGeometry(chatScroll);
			const positionedDistance =
				testCase.order === "newest-first"
					? positionedNearLatest.distanceFromStart
					: positionedNearLatest.distanceFromEnd;
			expect(positionedDistance).toBeGreaterThan(1);
			expect(positionedDistance).toBeLessThan(50);

			await moveMouseToChatViewport(page, chatScroll);
			await page.mouse.wheel(0, testCase.latestWheel > 0 ? 1 : -1);
			await expect
				.poll(async () => latestDistance(testCase.order, await readChatScrollGeometry(chatScroll)))
				.toBeLessThan(positionedDistance);
			await waitForScrollStability(chatScroll);
			const near = await readChatScrollGeometry(chatScroll);
			const nearDistance = latestDistance(testCase.order, near);
			expect(nearDistance).toBeLessThan(positionedDistance);
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
			await waitForScrollStability(chatScroll);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await expect(page.getByTestId(testCase.buttonTestId)).toHaveCount(0);
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} detaches when native latest input interrupts an idle return`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		try {
			const interruptionStart = await moveIntoStableHistory(
				page,
				chatScroll,
				testCase.order,
				testCase.historyWheel,
			);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await page.getByTestId(testCase.buttonTestId).evaluate((button) => button.click());
			await chatScroll.evaluate(
				(root, { scrollTop, deltaY }) => {
					const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
					if (!scroller) throw new Error("missing Virtuoso scroller");
					scroller.scrollTop = scrollTop;
					scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY }));
					scroller.scrollTop = scrollTop + deltaY;
					scroller.dispatchEvent(new Event("scroll"));
				},
				{
					scrollTop: interruptionStart.scrollTop,
					deltaY: testCase.latestWheel > 0 ? 20 : -20,
				},
			);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await waitForScrollStability(chatScroll);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			expect(
				latestDistance(testCase.order, await readChatScrollGeometry(chatScroll)),
			).toBeGreaterThan(1);
			await expect(page.getByTestId(testCase.buttonTestId)).toContainText("Latest");
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} retains pointer intent through post-release scrollbar scrolling`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		const scroller = chatScroll.locator("[data-virtuoso-scroller]");
		const releasedPointerScroll = async (target: "history" | "latest" | "near-latest") => {
			await scroller.dispatchEvent("pointerdown", {
				pointerId: 41,
				pointerType: "mouse",
				isPrimary: true,
			});
			await scroller.dispatchEvent("pointerup", {
				pointerId: 41,
				pointerType: "mouse",
				isPrimary: true,
			});
			await chatScroll.evaluate(
				async (root, { order, target }) => {
					await new Promise(requestAnimationFrame);
					const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
					if (!scroller) throw new Error("missing Virtuoso scroller");
					const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
					scroller.scrollTop =
						target === "history"
							? order === "newest-first"
								? Math.min(300, maxScrollTop)
								: Math.max(0, maxScrollTop - 300)
							: target === "near-latest"
								? order === "newest-first"
									? 25
									: Math.max(0, maxScrollTop - 25)
								: order === "newest-first"
									? 0
									: maxScrollTop;
					scroller.dispatchEvent(new Event("scroll"));
				},
				{ order: testCase.order, target },
			);
		};
		try {
			await releasedPointerScroll("history");
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await chatScroll.evaluate((root) => {
				root
					.querySelector<HTMLElement>("[data-virtuoso-scroller]")
					?.dispatchEvent(new Event("scrollend"));
			});
			const latest = page.getByTestId(testCase.buttonTestId);
			await latest.click();
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");
			await moveMouseToChatViewport(page, chatScroll);
			await page.mouse.wheel(0, testCase.historyWheel);
			await expect
				.poll(async () => latestDistance(testCase.order, await readChatScrollGeometry(chatScroll)))
				.toBeGreaterThan(100);
			await waitForScrollStability(chatScroll);

			await releasedPointerScroll("latest");
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await expect(chatScroll).toHaveAttribute("data-scroll-moving", "false");

			await releasedPointerScroll("history");
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await releasedPointerScroll("near-latest");
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await page.waitForTimeout(NATIVE_SCROLL_INTENT_EXPIRY_MS);
			await chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				scroller.scrollTop =
					order === "newest-first" ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} recognizes keyboard and focus-induced transcript scrolling`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		const scroller = chatScroll.locator("[data-virtuoso-scroller]");
		try {
			await scroller.dispatchEvent("keydown", {
				key: testCase.order === "newest-first" ? "PageDown" : "PageUp",
			});
			await chatScroll.evaluate((root, order) => {
				const element = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!element) throw new Error("missing Virtuoso scroller");
				const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
				element.scrollTop =
					order === "newest-first" ? Math.min(300, maxScrollTop) : Math.max(0, maxScrollTop - 300);
				element.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

			await scroller.dispatchEvent("keydown", {
				key: testCase.order === "newest-first" ? "Home" : "End",
			});
			await expect
				.poll(async () => latestDistance(testCase.order, await readChatScrollGeometry(chatScroll)))
				.toBeLessThanOrEqual(1);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");

			const interactive = chatScroll.getByTestId("chat-copy").last();
			await expect(interactive).toBeAttached();
			await interactive.dispatchEvent("keydown", { key: "Tab" });
			await chatScroll.evaluate((root, order) => {
				const element = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!element) throw new Error("missing Virtuoso scroller");
				const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
				element.scrollTop =
					order === "newest-first" ? Math.min(200, maxScrollTop) : Math.max(0, maxScrollTop - 200);
				element.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} keeps control activation neutral during automatic geometry`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		const copy = chatScroll.getByTestId("chat-copy").last();
		const applyGeometryShift = () =>
			chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.scrollTop =
					order === "newest-first" ? Math.min(200, maxScrollTop) : Math.max(0, maxScrollTop - 200);
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
		try {
			await expect(copy).toBeAttached();
			await copy.dispatchEvent("pointerdown", {
				pointerId: 52,
				pointerType: "mouse",
				isPrimary: true,
			});
			await applyGeometryShift();
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await copy.dispatchEvent("pointerup", {
				pointerId: 52,
				pointerType: "mouse",
				isPrimary: true,
			});
			await chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				scroller.scrollTop =
					order === "newest-first" ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await applyGeometryShift();
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				scroller.scrollTop =
					order === "newest-first" ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(copy).toBeAttached();
			await copy.dispatchEvent("keydown", { key: "Enter" });
			await applyGeometryShift();
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
			await expect(page.getByTestId(testCase.buttonTestId)).toHaveCount(0);
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} keeps touch intent through canceled-pointer momentum`, async ({
		page,
	}) => {
		const { session, chatScroll } = await openTallChat(page, testCase.order);
		try {
			await chatScroll.dispatchEvent("pointerdown", {
				pointerId: 73,
				pointerType: "touch",
				isPrimary: true,
			});
			await chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.scrollTop =
					order === "newest-first" ? Math.min(300, maxScrollTop) : Math.max(0, maxScrollTop - 300);
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
			await chatScroll.dispatchEvent("pointercancel", {
				pointerId: 73,
				pointerType: "touch",
				isPrimary: true,
			});
			await chatScroll.evaluate((root, order) => {
				const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
				if (!scroller) throw new Error("missing Virtuoso scroller");
				scroller.scrollTop =
					order === "newest-first" ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.dispatchEvent(new Event("scroll"));
			}, testCase.order);
			await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test(`${testCase.order} keeps an idle status slot at the logical latest edge`, async ({
		page,
	}) => {
		const { session } = await openTallChat(page, testCase.order);
		try {
			const slot = page.getByTestId("chat-status-slot");
			await expect(slot).toHaveCount(1);
			await expect(slot).toHaveAttribute("data-active", "false");
			const slotBox = await slot.boundingBox();
			expect(slotBox?.height).toBeGreaterThan(0);
			const latestRow = page
				.locator("[data-chat-row-index]")
				.filter({ hasText: "answer 40: the deterministic scrolling fixture is complete" });
			await expect(latestRow).toBeAttached();
			const latestRowBox = await latestRow.boundingBox();
			expect(latestRowBox).not.toBeNull();
			if (testCase.order === "newest-first") {
				expect((slotBox?.y ?? 0) + (slotBox?.height ?? 0)).toBeLessThanOrEqual(
					(latestRowBox?.y ?? 0) + 1,
				);
			} else {
				expect(slotBox?.y ?? 0).toBeGreaterThanOrEqual(
					(latestRowBox?.y ?? 0) + (latestRowBox?.height ?? 0) - 1,
				);
			}
			await expect(page.getByTestId("stream-indicator")).toHaveCount(0);
		} finally {
			rmSync(session.path, { force: true });
		}
	});
}
