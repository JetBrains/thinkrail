import { realpathSync, rmSync, utimesSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_700_000_000;

async function selectMessageOrder(page: Page, order: "oldest-first" | "newest-first") {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId(`chat-order-${order}`);
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
}

test("the browser-local message-order preference reverses rows without changing another browser", async ({
	browser,
	page,
}) => {
	await openFixtureProject(page);
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "message order chat",
		messages: [
			{ role: "user", text: "oldest request", timestamp: BASE_TS },
			{ role: "assistant", text: "oldest answer", timestamp: BASE_TS + 1_000 },
			{ role: "user", text: "newest request", timestamp: BASE_TS + 2_000 },
			{ role: "assistant", text: "newest answer", timestamp: BASE_TS + 3_000 },
		],
	});
	utimesSync(session.path, new Date(BASE_TS + 10_000), new Date(BASE_TS + 10_000));

	try {
		await selectMessageOrder(page, "oldest-first");
		await enterDefaultWorkspace(page);
		await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

		const messages = page.getByTestId("chat-message");
		await expect(messages).toHaveText([
			"oldest request",
			"oldest answer",
			"newest request",
			"newest answer",
		]);

		await selectMessageOrder(page, "newest-first");
		await expect(messages).toHaveText([
			"newest answer",
			"newest request",
			"oldest answer",
			"oldest request",
		]);
		await expect(page.getByText("newest answer")).toBeInViewport();

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(messages).toHaveText([
			"newest answer",
			"newest request",
			"oldest answer",
			"oldest request",
		]);

		const isolatedContext = await browser.newContext();
		try {
			const isolatedPage = await isolatedContext.newPage();
			await isolatedPage.goto(new URL("/", page.url()).href);
			await expect(isolatedPage.getByTestId("connection-status")).toHaveAttribute(
				"data-status",
				"connected",
			);
			await isolatedPage.getByTestId("open-settings").click();
			await isolatedPage.getByTestId("settings-nav-chat").click();
			await expect(isolatedPage.getByTestId("chat-order-oldest-first")).toHaveAttribute(
				"data-active",
				"true",
			);
		} finally {
			await isolatedContext.close();
		}
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("newest-first scrolls down into history and returns upward to the latest group", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "long newest-first chat",
		messages: Array.from({ length: 30 }, (_, index) => [
			{
				role: "user" as const,
				text: `request ${index + 1}: inspect the deliberately verbose fixture`,
				timestamp: BASE_TS + index * 2_000,
			},
			{
				role: "assistant" as const,
				text: `answer ${index + 1}: the deliberately verbose fixture has been inspected`,
				timestamp: BASE_TS + index * 2_000 + 1_000,
			},
		]).flat(),
	});
	utimesSync(session.path, new Date(BASE_TS + 20_000), new Date(BASE_TS + 20_000));

	try {
		await selectMessageOrder(page, "newest-first");
		await enterDefaultWorkspace(page);
		await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
		const chatScroll = page.getByTestId("chat-scroll");
		await expect(
			page.getByText("answer 30: the deliberately verbose fixture has been inspected"),
		).toBeInViewport();

		const scrollPoint = await chatScroll.evaluate((root) => {
			const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 8) return null;
			const rect = scroller.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		});
		expect(scrollPoint).not.toBeNull();
		if (!scrollPoint) return;
		await page.mouse.move(scrollPoint.x, scrollPoint.y);
		await page.mouse.wheel(0, 10_000);

		const latest = page.getByTestId("scroll-to-top");
		await expect(latest).toBeVisible();
		await expect(latest).toContainText("Latest");
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await latest.focus();
		await page.keyboard.press("ArrowUp");
		await expect(latest).toBeVisible();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

		const scroller = chatScroll.locator("[data-virtuoso-scroller]");
		await scroller.focus();
		await scroller.evaluate((element) => {
			element.addEventListener("keydown", (event) => event.preventDefault(), {
				capture: true,
				once: true,
			});
		});
		await page.keyboard.press("Home");
		await expect(latest).toBeVisible();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await page.keyboard.press("Home");
		await expect(latest).toHaveCount(0);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		await expect(
			page.getByText("answer 30: the deliberately verbose fixture has been inspected"),
		).toBeInViewport();

		await page.mouse.wheel(0, 10_000);
		await expect(latest).toBeVisible();
		await latest.click();
		await expect(latest).toHaveCount(0);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");

		await page.mouse.wheel(0, 10_000);
		await expect(latest).toBeVisible();
		await chatScroll.evaluate((root) => {
			const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) return;
			scroller.scrollTop = Math.max(50, scroller.scrollTop / 2);
			scroller.dispatchEvent(new Event("scroll"));
		});
		await chatScroll.dispatchEvent("pointerdown", { pointerType: "touch" });
		await chatScroll.evaluate((root) => {
			const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) return;
			scroller.scrollTop = Math.max(1, scroller.scrollTop - 20);
			scroller.dispatchEvent(new Event("scroll"));
		});
		await page.waitForTimeout(300);
		await chatScroll.dispatchEvent("pointercancel", { pointerType: "touch" });
		await chatScroll.evaluate((root) => {
			const scroller = root.querySelector<HTMLElement>("[data-virtuoso-scroller]");
			if (!scroller) return;
			scroller.scrollTop += 40;
			scroller.dispatchEvent(new Event("scroll"));
			scroller.scrollTop = 0;
			scroller.dispatchEvent(new Event("scroll"));
		});
		await expect(latest).toHaveCount(0);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	} finally {
		rmSync(session.path, { force: true });
	}
});
