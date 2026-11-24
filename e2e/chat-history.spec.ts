import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
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
import { E2eWire } from "./fixtures/wire";

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

test("the native name command renames a chat durably without sending an agent turn", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedWorkspaceSession(repoCwd(), {
		name: "before command rename",
		messages: [{ role: "user", text: "existing prompt", timestamp: BASE_TS }],
	});

	await enterDefaultWorkspace(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTab).toContainText("before command rename");
	const input = page.getByTestId("chat-input");
	await input.fill("/name Command renamed chat");
	await input.press("Enter");
	await expect(chatTab).toContainText("Command renamed chat");
	await expect(input).toHaveValue("");
	await expect(page.getByText("/name Command renamed chat", { exact: true })).toHaveCount(0);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toContainText(
		"Command renamed chat",
	);
});

test("open and closed chat rename controls edit their labels inline", async ({ page }) => {
	await openFixtureProject(page);
	const closed = seedWorkspaceSession(repoCwd(), {
		name: "closed before rename",
		messages: [{ role: "user", text: "older prompt", timestamp: BASE_TS }],
	});
	setMtime(closed.path, BASE_TS);
	const open = seedWorkspaceSession(repoCwd(), {
		name: "open before rename",
		messages: [{ role: "user", text: "newer prompt", timestamp: BASE_TS + 10_000 }],
	});
	setMtime(open.path, BASE_TS + 10_000);

	await enterDefaultWorkspace(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTab).toContainText("open before rename");
	const startTabRename = async () => {
		await chatTab.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Rename chat", exact: true }).click();
		const input = chatTab.getByTestId("chat-tab-name-input");
		await expect(input).toBeFocused();
		return input;
	};
	let tabNameInput = await startTabRename();
	await expect(tabNameInput).toHaveValue("open before rename");
	await tabNameInput.fill("x".repeat(81));
	await tabNameInput.press("Enter");
	await expect(chatTab.getByRole("tab")).toBeFocused();
	await expect(chatTab).toContainText("open before rename");

	tabNameInput = await startTabRename();
	await tabNameInput.fill("discarded tab rename");
	await tabNameInput.press("Escape");
	await expect(chatTab.getByRole("tab")).toBeFocused();
	await expect(chatTab).toContainText("open before rename");

	tabNameInput = await startTabRename();
	await tabNameInput.fill("open after rename");
	await tabNameInput.press("Enter");
	await expect(tabNameInput).toHaveCount(0);
	await expect(chatTab.getByRole("tab")).toBeFocused();
	await expect(chatTab).toContainText("open after rename");

	await page.getByTestId("chat-history").first().click();
	const closedRow = page.locator(`[data-testid="closed-chat-row"][data-session-id="${closed.id}"]`);
	const startHistoryRename = async () => {
		await closedRow.getByTestId("closed-chat-rename").click();
		const input = closedRow.getByTestId("closed-chat-name-input");
		await expect(input).toBeFocused();
		return input;
	};
	let historyNameInput = await startHistoryRename();
	await expect(historyNameInput).toHaveValue("closed before rename");
	await historyNameInput.fill("x".repeat(81));
	await historyNameInput.press("Enter");
	await expect(closedRow.getByTestId("closed-chat-item")).toBeFocused();
	await expect(closedRow).toContainText("closed before rename");

	historyNameInput = await startHistoryRename();
	await historyNameInput.fill("discarded history rename");
	await historyNameInput.press("Escape");
	await expect(closedRow.getByTestId("closed-chat-item")).toBeFocused();
	await expect(closedRow).toContainText("closed before rename");

	historyNameInput = await startHistoryRename();
	await historyNameInput.fill("closed after rename");
	await historyNameInput.press("Enter");
	await expect(historyNameInput).toHaveCount(0);
	await expect(closedRow.getByTestId("closed-chat-item")).toBeFocused();
	await expect(chatTab).toHaveCount(1);
	await expect(closedRow).toContainText("closed after rename");
});

test("long chat history remains named and scrollable", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 760 });
	await openFixtureProject(page);
	for (let index = 0; index < 30; index += 1) {
		const session = seedWorkspaceSession(repoCwd(), {
			name: `history item ${String(index).padStart(2, "0")}`,
			messages: [{ role: "user", text: `prompt ${index}`, timestamp: BASE_TS + index * 1_000 }],
		});
		setMtime(session.path, BASE_TS + index * 1_000);
	}

	await enterDefaultWorkspace(page);
	await page.getByTestId("chat-history").first().click();
	const popover = page.getByTestId("chat-history-popover");
	await expect(popover).toHaveAccessibleName("Recently closed");
	await expect
		.poll(() => popover.evaluate((node) => node.scrollHeight > node.clientHeight))
		.toBe(true);
	const oldest = page.getByTestId("closed-chat-item").filter({ hasText: "history item 00" });
	await oldest.scrollIntoViewIfNeeded();
	await expect(oldest).toBeVisible();
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
	const searchPrompt = `delete this from search ${randomUUID()}`;
	const searchDoomed = seedWorkspaceSession(repoCwd(), {
		name: "search trash chat",
		messages: [{ role: "user", text: searchPrompt, timestamp: BASE_TS + 10_000 }],
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
	await page.getByTestId("history-query").fill(searchPrompt);
	const searchRow = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: searchPrompt });
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
	const page2 = await context2.newPage();
	let offline = false;
	let socket: WebSocketRoute | undefined;
	await page2.routeWebSocket(/\/ws(\?|$)/, async (ws) => {
		if (offline) return ws.close();
		socket = ws;
		ws.connectToServer();
	});
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).click();
	await expect(page2.getByText("offline doomed transcript")).toBeVisible();

	offline = true;
	await socket?.close();
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

	await expect(page2.getByText("offline doomed transcript")).toBeVisible();
	offline = false;
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected", {
		timeout: 15_000,
	});
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

interface Frame {
	id?: string;
	method?: string;
	params?: { sessionId?: string };
	result?: { messages?: unknown[] };
}

function frameOf(message: string | Buffer): Frame | null {
	try {
		return JSON.parse(message.toString()) as Frame;
	} catch {
		return null;
	}
}

const openChatTabs = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="chat"]');
const activeTab = (page: Page) => page.locator('[data-testid="editor-tab"][data-active="true"]');

interface ChatRoute {
	workspaceId: string;
	sessionId: string;
}

async function currentChat(page: Page): Promise<ChatRoute> {
	await expect.poll(() => page.evaluate(() => window.location.hash)).toContain("/chats/");
	const segments = (await page.evaluate(() => window.location.hash)).split("/");
	const [workspaceId, sessionId] = [segments[5], segments[7]];
	if (!workspaceId || !sessionId) throw new Error("the route names no chat");
	return { workspaceId: decodeURIComponent(workspaceId), sessionId: decodeURIComponent(sessionId) };
}

interface FirstSocketReads {
	breakOf?: () => string | undefined;
	dropOf?: () => string | undefined;
}

async function routeDroppableSocket(
	page: Page,
	firstSocket: FirstSocketReads = {},
): Promise<{
	droppedReads: string[];
	reconnectReads: string[];
	reconnect(): Promise<void>;
	reconnectAndRename(chat: ChatRoute, title: string): Promise<void>;
}> {
	let socket: WebSocketRoute | undefined;
	let socketsOpened = 0;
	let listsAnswered = 0;
	const seenRequestIds = new Set<string>();
	const droppedReads: string[] = [];
	const reconnectReads: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		socketsOpened += 1;
		listsAnswered = 0;
		const reconnected = socketsOpened > 1;
		const lists = new Set<string>();
		const brokenReads = new Set<string>();
		socket = ws;
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const frame = frameOf(message);
			const id = frame?.id;
			const resent = id !== undefined && seenRequestIds.has(id);
			if (frame?.method === "session.list" && id && !resent) lists.add(id);
			const read = frame?.method === "session.getMessages" ? frame.params?.sessionId : undefined;
			if (reconnected && read && !resent) reconnectReads.push(read);
			if (id) seenRequestIds.add(id);
			if (!reconnected && read && id) {
				if (read === firstSocket.dropOf?.()) {
					droppedReads.push(read);
					return;
				}
				if (read === firstSocket.breakOf?.()) brokenReads.add(id);
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = frameOf(message);
			const id = frame?.id;
			if (id && brokenReads.has(id) && Array.isArray(frame.result?.messages)) {
				frame.result.messages.push({ role: "user", content: null, timestamp: BASE_TS });
				ws.send(JSON.stringify(frame));
				return;
			}
			ws.send(message);
			if (ws === socket && id && lists.has(id)) listsAnswered += 1;
		});
	});
	const reconnect = async () => {
		const before = socketsOpened;
		await socket?.close();
		await expect.poll(() => socketsOpened).toBeGreaterThan(before);
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect.poll(() => listsAnswered).toBeGreaterThan(0);
	};
	return {
		droppedReads,
		reconnectReads,
		reconnect,
		async reconnectAndRename(chat, title) {
			await reconnect();
			const wire = await E2eWire.connect(Number(new URL(page.url()).port));
			try {
				await wire.request("session.rename", { ...chat, title });
			} finally {
				wire.close();
			}
		},
	};
}

test("a chat closed to history stays there after a reconnect", async ({ page }) => {
	const socket = await routeDroppableSocket(page);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("new-chat").first().click();
	await expect(openChatTabs(page)).toHaveCount(1);
	const current = await currentChat(page);
	await page.getByTestId("new-chat").first().click();
	await expect(openChatTabs(page)).toHaveCount(2);
	await expect.poll(async () => (await currentChat(page)).sessionId).not.toBe(current.sessionId);
	await activeTab(page).getByTestId("editor-tab-close").click();
	await expect(openChatTabs(page)).toHaveCount(1);
	await expect.poll(async () => (await currentChat(page)).sessionId).toBe(current.sessionId);

	await socket.reconnectAndRename(current, "the current chat");

	await expect(activeTab(page)).toContainText("the current chat");
	await expect(openChatTabs(page)).toHaveCount(1);
	await page.getByTestId("chat-history").first().click();
	await expect(page.getByTestId("closed-chat-item")).toHaveCount(1);
});

test("a chat another window started stays in history after a reconnect", async ({
	page,
	context,
}) => {
	const socket = await routeDroppableSocket(page);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("new-chat").first().click();
	await expect(openChatTabs(page)).toHaveCount(1);
	const current = await currentChat(page);

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).click();
	await expect(openChatTabs(page2)).toHaveCount(1);
	await page2.getByTestId("new-chat").first().click();
	await expect(openChatTabs(page2)).toHaveCount(2);
	await expect.poll(async () => (await currentChat(page2)).sessionId).not.toBe(current.sessionId);
	const peer = await currentChat(page2);
	await page.getByTestId("chat-history").first().click();
	await expect(page.getByTestId("closed-chat-item")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("closed-chat-item")).toHaveCount(0);

	await socket.reconnectAndRename(current, "the current chat");

	await expect(activeTab(page)).toContainText("the current chat");
	expect(socket.reconnectReads).not.toContain(peer.sessionId);
	await expect(openChatTabs(page)).toHaveCount(1);
	await page.getByTestId("chat-history").first().click();
	await expect(page.getByTestId("closed-chat-item")).toHaveCount(1);
	await page2.close();
});

test("an auto-open cut by a dropped socket runs on the next connection", async ({ page }) => {
	let socketsOpened = 0;
	let cutRequestId: string | undefined;
	let cutReadAnswered = () => {};
	const cutReadAnsweredOnNewSocket = new Promise<void>((resolve) => {
		cutReadAnswered = resolve;
	});
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		socketsOpened += 1;
		const first = socketsOpened === 1;
		const lists = new Set<string>();
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const frame = frameOf(message);
			if (first && frame?.method === "session.getMessages") {
				cutRequestId = frame.id;
				void ws.close();
				return;
			}
			if (!first && frame?.method === "session.list" && frame.id) lists.add(frame.id);
			server.send(message);
		});
		server.onMessage((message) => {
			const id = frameOf(message)?.id;
			if (!first && id && lists.has(id)) {
				void cutReadAnsweredOnNewSocket.then(() => ws.send(message));
				return;
			}
			ws.send(message);
			if (!first && id && id === cutRequestId) cutReadAnswered();
		});
	});
	await openFixtureProject(page);
	const only = seedWorkspaceSession(repoCwd(), {
		name: "cut fallback chat",
		messages: [{ role: "user", text: "the cut fallback chat", timestamp: BASE_TS }],
	});
	setMtime(only.path, BASE_TS);

	await enterDefaultWorkspace(page);

	await expect.poll(() => cutRequestId).toBeDefined();
	await expect.poll(() => socketsOpened).toBeGreaterThan(1);
	await expect(openChatTabs(page)).toHaveCount(1);
	await expect(page.getByText("the cut fallback chat")).toBeVisible();
});

test("a reconnect after a first entry that opened a chat keeps the rest in history", async ({
	page,
}) => {
	let heldSessionId: string | undefined;
	const socket = await routeDroppableSocket(page, { dropOf: () => heldSessionId });
	await openFixtureProject(page);
	const opened = seedWorkspaceSession(repoCwd(), {
		name: "opened todo chat",
		messages: [{ role: "user", text: "the opened todo chat", timestamp: BASE_TS + 50_000 }],
	});
	setMtime(opened.path, BASE_TS + 50_000);
	seedOpenTodo(opened.id, "finish the opened chat");
	const held = seedWorkspaceSession(repoCwd(), {
		name: "held todo chat",
		messages: [{ role: "user", text: "the held todo chat", timestamp: BASE_TS }],
	});
	setMtime(held.path, BASE_TS);
	seedOpenTodo(held.id, "finish the held chat");
	heldSessionId = held.id;

	await enterDefaultWorkspace(page);
	await expect(page.getByText("the opened todo chat")).toBeVisible();
	expect(socket.droppedReads).toContain(held.id);
	const current = await currentChat(page);

	await socket.reconnectAndRename(current, "the opened chat");

	await expect(activeTab(page)).toContainText("the opened chat");
	expect(socket.reconnectReads).not.toContain(held.id);
	await expect(openChatTabs(page)).toHaveCount(1);
	await page.getByTestId("chat-history").first().click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "held todo chat" }),
	).toBeVisible();
});

test("a first entry that failed to load its chats does not retry on a reconnect", async ({
	page,
}) => {
	let brokenSessionId: string | undefined;
	const socket = await routeDroppableSocket(page, { breakOf: () => brokenSessionId });
	await openFixtureProject(page);
	const broken = seedWorkspaceSession(repoCwd(), {
		name: "broken todo chat",
		messages: [{ role: "user", text: "the broken todo chat", timestamp: BASE_TS }],
	});
	setMtime(broken.path, BASE_TS);
	seedOpenTodo(broken.id, "finish the broken chat");
	brokenSessionId = broken.id;

	await enterDefaultWorkspace(page);
	await expect(page.locator('[data-testid="toast"][data-variant="error"]')).toBeVisible();
	await page.getByTestId("new-chat").first().click();
	await expect(openChatTabs(page)).toHaveCount(1);
	const current = await currentChat(page);

	await socket.reconnectAndRename(current, "the current chat");

	await expect(activeTab(page)).toContainText("the current chat");
	expect(socket.reconnectReads).not.toContain(broken.id);
	await expect(openChatTabs(page)).toHaveCount(1);
});

test("a first entry finished on the next connection keeps a later closed chat in history", async ({
	page,
}) => {
	let heldSessionId: string | undefined;
	const socket = await routeDroppableSocket(page, { dropOf: () => heldSessionId });
	await openFixtureProject(page);
	const held = seedWorkspaceSession(repoCwd(), {
		name: "held todo chat",
		messages: [{ role: "user", text: "the held todo chat", timestamp: BASE_TS }],
	});
	setMtime(held.path, BASE_TS);
	seedOpenTodo(held.id, "finish the held chat");
	heldSessionId = held.id;

	await enterDefaultWorkspace(page);
	await expect.poll(() => socket.droppedReads).toContain(held.id);
	await socket.reconnect();
	await expect(page.getByText("the held todo chat")).toBeVisible();
	await page.getByTestId("new-chat").first().click();
	await expect(openChatTabs(page)).toHaveCount(2);
	await expect.poll(async () => (await currentChat(page)).sessionId).not.toBe(held.id);
	const current = await currentChat(page);
	await openChatTabs(page).filter({ hasText: "held todo chat" }).click();
	await expect(activeTab(page)).toContainText("held todo chat");
	await activeTab(page).getByTestId("editor-tab-close").click();
	await expect(openChatTabs(page)).toHaveCount(1);

	await socket.reconnectAndRename(current, "the current chat");

	await expect(activeTab(page)).toContainText("the current chat");
	await expect(openChatTabs(page)).toHaveCount(1);
	await page.getByTestId("chat-history").first().click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "held todo chat" }),
	).toBeVisible();
});
