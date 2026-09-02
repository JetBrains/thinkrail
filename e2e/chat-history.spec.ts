import { existsSync, mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { TodoStore } from "pi-todos/core";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	revealFirstProjectWorkspaces,
} from "./fixtures/app";
import {
	moveMouseToChatViewport,
	readChatScrollGeometry,
	readChatViewportIntersection,
} from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_200_000_000;

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

function setMtime(path: string, ms: number): void {
	utimesSync(path, new Date(ms), new Date(ms));
}

function seedOpenTodo(sessionId: string, title: string): void {
	const contextDir = join(repoCwd(), ".thinkrail", "context");
	mkdirSync(contextDir, { recursive: true });
	writeFileSync(join(contextDir, ".gitignore"), "*\n");
	new TodoStore(repoCwd(), sessionId).add({ title });
}

test.afterEach(() => {
	rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
});

test("a disk chat with unfinished work auto-opens; a finished one stays in local history", async ({
	page,
}) => {
	await openFixtureProject(page);

	const todoChat = seedWorkspaceSession(repoCwd(), {
		name: "the migration chat",
		messages: [
			{ role: "user", text: "start the migration", timestamp: BASE_TS },
			...Array.from({ length: 30 }, (_, i) => ({
				role: "assistant" as const,
				text: `migration step ${i + 1} done`,
				timestamp: BASE_TS + 1_000 + i,
			})),
			{
				role: "assistant",
				text: "stopped before the final verification pass",
				timestamp: BASE_TS + 60_000,
			},
		],
	});
	setMtime(todoChat.path, BASE_TS);
	seedOpenTodo(todoChat.id, "run the final verification pass");

	const doneChat = seedWorkspaceSession(repoCwd(), {
		name: "release notes chat",
		messages: [{ role: "user", text: "ship the release notes", timestamp: BASE_TS + 100_000 }],
	});
	setMtime(doneChat.path, BASE_TS + 100_000);

	await enterDefaultWorkspace(page);

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTabs).toHaveCount(1);
	await expect(page.getByText("stopped before the final verification pass")).toBeVisible();
	await page.getByTestId("chat-history").first().click();
	await expect(page.getByTestId("closed-chat-item")).toHaveCount(1);
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "release notes chat" }),
	).toBeVisible();
});

test("coarse wheel input crosses realistic virtual geometry before a giant history row mounts", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 760 });
	await openFixtureProject(page);

	const longBlockMarker = "canonical giant history block";
	const longBlock = [
		longBlockMarker,
		...Array.from(
			{ length: 100 },
			(_, index) =>
				`Paragraph ${index + 1} records enough deterministic transcript detail to wrap across the chat column while preserving this assistant response as one canonical Markdown row.`,
		),
	].join("\n\n");
	seedWorkspaceSession(repoCwd(), {
		name: "giant hydrated history",
		messages: [
			{ role: "user", text: "Write the complete migration record.", timestamp: BASE_TS },
			{ role: "assistant", text: longBlock, timestamp: BASE_TS + 1_000 },
			...Array.from({ length: 14 }, (_, index) => [
				{
					role: "user" as const,
					text: `short follow-up ${index + 1}`,
					timestamp: BASE_TS + 2_000 + index * 2_000,
				},
				{
					role: "assistant" as const,
					text: `short answer ${index + 1}`,
					timestamp: BASE_TS + 3_000 + index * 2_000,
				},
			]).flat(),
		],
	});

	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "giant hydrated history");

	const chatScroll = page.getByTestId("chat-scroll");
	const latestRow = page
		.locator('[data-testid="chat-message"][data-role="assistant"]')
		.filter({ hasText: "short answer 14" });
	await expect(latestRow).toBeVisible();
	await expect
		.poll(async () => (await readChatViewportIntersection(latestRow)).intersects)
		.toBe(true);
	await expect(page.getByText(longBlockMarker, { exact: true })).toHaveCount(0);

	const coarseDelta = 1_000;
	const substantialTravelFloor = coarseDelta * 1.5;
	await expect
		.poll(async () => {
			const geometry = await readChatScrollGeometry(chatScroll);
			return geometry.distanceFromEnd <= geometry.clientHeight * 0.02;
		})
		.toBe(true);
	const initial = await readChatScrollGeometry(chatScroll);
	expect(initial.maxScrollTop).toBeGreaterThan(coarseDelta * 2 + initial.clientHeight);

	await moveMouseToChatViewport(page, chatScroll);
	await page.mouse.wheel(0, -coarseDelta);
	await page.mouse.wheel(0, -coarseDelta);

	await expect
		.poll(async () => {
			const geometry = await readChatScrollGeometry(chatScroll);
			return {
				substantialTravel: geometry.distanceFromEnd > substantialTravelFloor,
				clearOfHistoryStart: geometry.distanceFromStart > geometry.clientHeight,
			};
		})
		.toEqual({ substantialTravel: true, clearOfHistoryStart: true });
	const after = await readChatScrollGeometry(chatScroll);
	await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	const latest = page.getByTestId("scroll-to-bottom");
	await expect(latest).toBeVisible();
	await expect(latest).toContainText("Latest");

	expect(after.distanceFromEnd).toBeGreaterThan(substantialTravelFloor);
	expect(after.distanceFromStart).toBeGreaterThan(after.clientHeight);

	await latest.click();
	await expect(latest).toHaveCount(0);
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	await expect
		.poll(async () => {
			const geometry = await readChatScrollGeometry(chatScroll);
			return {
				atPhysicalLatestEdge: geometry.distanceFromEnd <= geometry.clientHeight * 0.02,
				latestRowIntersectsViewport: (await readChatViewportIntersection(latestRow)).intersects,
			};
		})
		.toEqual({ atPhysicalLatestEdge: true, latestRowIntersectsViewport: true });

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(latestRow).toBeVisible();
	await expect(page.getByText(longBlockMarker, { exact: true })).toHaveCount(0);
	await expect
		.poll(async () => (await readChatScrollGeometry(chatScroll)).distanceFromEnd)
		.toBeLessThanOrEqual(16);
	await moveMouseToChatViewport(page, chatScroll);
	for (let delta = 0; delta < 20; delta += 1) {
		await page.mouse.wheel(0, -100);
		await page.evaluate(() => new Promise(requestAnimationFrame));
	}
	const granular = await readChatScrollGeometry(chatScroll);

	expect(granular.distanceFromEnd).toBeGreaterThan(substantialTravelFloor);
	expect(Math.abs(granular.distanceFromEnd - after.distanceFromEnd)).toBeLessThanOrEqual(
		granular.clientHeight,
	);
});

test("a closed chat can be moved to trash from history", async ({ page }) => {
	await openFixtureProject(page);

	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "trash this chat",
		messages: [{ role: "user", text: "remove this transcript", timestamp: BASE_TS }],
	});
	setMtime(doomed.path, BASE_TS);
	const searchDoomed = seedWorkspaceSession(repoCwd(), {
		name: "search trash chat",
		messages: [{ role: "user", text: "delete this from search", timestamp: BASE_TS + 10_000 }],
	});
	setMtime(searchDoomed.path, BASE_TS + 10_000);
	const kept = seedWorkspaceSession(repoCwd(), {
		name: "keep this chat",
		messages: [{ role: "user", text: "keep this transcript", timestamp: BASE_TS + 50_000 }],
	});
	setMtime(kept.path, BASE_TS + 50_000);

	await enterDefaultWorkspace(page);
	await expect(page.getByText("keep this transcript")).toBeVisible();
	await page.getByTestId("chat-history").first().click();
	const row = page.getByTestId("closed-chat-row").filter({ hasText: "trash this chat" });
	await row.getByTestId("closed-chat-delete").click();

	await expect.poll(() => existsSync(doomed.path)).toBe(false);
	await page.getByTestId("chat-history").first().click();
	await expect(
		page.getByTestId("closed-chat-row").filter({ hasText: "trash this chat" }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByText("remove this transcript")).toHaveCount(0);

	await page.getByTestId("chat-input").press("Control+r");
	await page.getByTestId("history-query").fill("delete this from search");
	const searchRow = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "delete this from search" });
	await searchRow.getByTestId("history-delete-chat").click();
	await expect(page.getByTestId("history-overlay")).toHaveCount(0);
	await expect.poll(() => existsSync(searchDoomed.path)).toBe(false);
});

test("trashing a chat converges to a second client", async ({ page, context }) => {
	await openFixtureProject(page);

	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "shared doomed chat",
		messages: [{ role: "user", text: "shared doomed transcript", timestamp: BASE_TS }],
	});
	setMtime(doomed.path, BASE_TS);

	await enterDefaultWorkspace(page);
	await expect(page.getByText("shared doomed transcript")).toBeVisible();

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).click();
	await expect(page2.getByText("shared doomed transcript")).toBeVisible();

	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").first().click();
	const row = page.getByTestId("closed-chat-row").filter({ hasText: "shared doomed chat" });
	await row.getByTestId("closed-chat-delete").click();

	await expect.poll(() => existsSync(doomed.path)).toBe(false);
	await expect(page2.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(page2.getByTestId("workspace-ready").first()).toBeVisible();
	await page2.close();
});

test("a client that misses chat deletion while offline reconciles it after reconnect", async ({
	page,
	browser,
}) => {
	await openFixtureProject(page);

	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "offline doomed chat",
		messages: [{ role: "user", text: "offline doomed transcript", timestamp: BASE_TS }],
	});
	setMtime(doomed.path, BASE_TS);

	await enterDefaultWorkspace(page);
	await expect(page.getByText("offline doomed transcript")).toBeVisible();

	const context2 = await browser.newContext();
	await context2.addInitScript(() => {
		const NativeWebSocket = window.WebSocket;
		class TrackedWebSocket extends NativeWebSocket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				Object.defineProperty(window, "__thinkrailE2eSocket", {
					configurable: true,
					value: this,
				});
			}
		}
		window.WebSocket = TrackedWebSocket;
	});
	const page2 = await context2.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).click();
	await expect(page2.getByText("offline doomed transcript")).toBeVisible();

	await context2.setOffline(true);
	await page2.evaluate(() => {
		const socket = Object.getOwnPropertyDescriptor(window, "__thinkrailE2eSocket")?.value;
		if (socket instanceof WebSocket) socket.close();
	});
	await expect(page2.getByTestId("connection-status")).toHaveAttribute(
		"data-status",
		"disconnected",
	);

	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").first().click();
	await page
		.getByTestId("closed-chat-row")
		.filter({ hasText: "offline doomed chat" })
		.getByTestId("closed-chat-delete")
		.click();
	await expect.poll(() => existsSync(doomed.path)).toBe(false);

	await context2.setOffline(false);
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page2.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(page2.getByTestId("workspace-ready").first()).toBeVisible();
	await context2.close();
});

test("with no TODOs, the single newest disk chat opens as a fallback; older ones stay in history", async ({
	page,
}) => {
	await openFixtureProject(page);

	const older = seedWorkspaceSession(repoCwd(), {
		name: "older fallback chat",
		messages: [{ role: "user", text: "the older fallback chat", timestamp: BASE_TS }],
	});
	setMtime(older.path, BASE_TS);
	const newest = seedWorkspaceSession(repoCwd(), {
		name: "newest fallback chat",
		messages: [{ role: "user", text: "the newest fallback chat", timestamp: BASE_TS + 50_000 }],
	});
	setMtime(newest.path, BASE_TS + 50_000);

	await enterDefaultWorkspace(page);

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTabs).toHaveCount(1);
	await expect(page.getByText("the newest fallback chat")).toBeVisible();
	await page.getByTestId("chat-history").first().click();
	await expect(page.getByTestId("closed-chat-item")).toHaveCount(1);
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "older fallback chat" }),
	).toBeVisible();
});
