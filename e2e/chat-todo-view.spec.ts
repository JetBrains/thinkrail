import { expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

const chatTabs = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="chat"]');

function chatTab(page: Page, sessionId: string): Locator {
	return page.locator(
		`[data-testid="editor-tab"][data-kind="chat"][data-session-id="${sessionId}"]`,
	);
}

function todoGroup(page: Page): Locator {
	return page.locator("[data-side][data-group-id]").filter({ has: page.getByTestId("tab-todos") });
}

async function setTodoView(page: Page, view: "chat-popover" | "side-tool"): Promise<void> {
	await page.getByTestId("open-settings").click();
	const settings = page.getByTestId("settings-dialog");
	await expect(settings).toBeVisible();
	await settings.getByTestId("settings-nav-chat").click();
	const choice = settings.getByTestId(
		view === "side-tool" ? "todo-view-side-tool" : "todo-view-chat-popover",
	);
	await choice.click();
	await expect(choice).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();
}

async function sessionIdOf(tab: Locator): Promise<string> {
	const sessionId = await tab.getAttribute("data-session-id");
	if (!sessionId) throw new Error("chat tab has no session id");
	return sessionId;
}

async function moveTodoToOwnGroup(page: Page): Promise<string> {
	await page.getByTestId("tab-todos").click({ button: "right" });
	const move = page.getByRole("menuitem", {
		name: "New right group at bottom",
		exact: true,
	});
	await expect(move).toBeEnabled();
	await move.click();
	await expect(todoGroup(page)).toHaveCount(1);
	const groupId = await todoGroup(page).getAttribute("data-group-id");
	if (!groupId) throw new Error("moved TODO tool has no group id");
	return groupId;
}

test("the side TODO tool preserves placement while following chat focus independently", async ({
	page,
}) => {
	type SocketMessage = Parameters<WebSocketRoute["send"]>[0];
	let holdTodoReads = false;
	const heldTodoReadSessions = new Map<string, string>();
	const heldTodoResponses = new Map<string, SocketMessage[]>();
	let browserSocket: WebSocketRoute | undefined;
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		browserSocket = socket;
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			const raw = message.toString();
			try {
				const frame = JSON.parse(raw) as {
					id?: string;
					method?: string;
					params?: { sessionId?: string };
				};
				if (holdTodoReads && frame.id && frame.method === "todo.list" && frame.params?.sessionId) {
					heldTodoReadSessions.set(frame.id, frame.params.sessionId);
				}
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as { id?: string };
				const sessionId = frame.id ? heldTodoReadSessions.get(frame.id) : undefined;
				if (frame.id && sessionId) {
					heldTodoReadSessions.delete(frame.id);
					const responses = heldTodoResponses.get(sessionId) ?? [];
					responses.push(message);
					heldTodoResponses.set(sessionId, responses);
					return;
				}
			} catch {}
			socket.send(message);
		});
	});
	const releaseTodoReads = async (sessionId: string) => {
		await expect.poll(() => (heldTodoResponses.get(sessionId)?.length ?? 0) >= 2).toBe(true);
		holdTodoReads = false;
		await expect.poll(() => heldTodoReadSessions.size).toBe(0);
		if (!browserSocket) throw new Error("TODO reads were not held");
		for (const responses of heldTodoResponses.values()) {
			for (const response of responses) browserSocket.send(response);
		}
		heldTodoResponses.clear();
	};

	test.setTimeout(60_000);
	await openWorkspaceChat(page);
	const chat1Id = await sessionIdOf(chatTabs(page).first());
	await setTodoView(page, "side-tool");

	const headerReceipt = page.getByTestId("chat-plan-toggle");
	await expect(headerReceipt).toBeVisible();
	await expect(headerReceipt.getByTestId("chat-plan-disclosure")).toHaveCount(0);
	await expect(page.getByTestId("chat-plan-popover")).toHaveCount(0);
	await expect(page.getByTestId("tab-todos")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("todo-panel")).toHaveAttribute("data-session-id", chat1Id);
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
	await page.getByTestId("tab-todos").click();
	await expect(page.getByTestId("tab-todos")).toHaveAttribute("data-active", "true");

	const manualGroupId = await moveTodoToOwnGroup(page);
	await setTodoView(page, "chat-popover");
	await expect(page.getByTestId("tab-todos")).toHaveCount(0);
	await expect(headerReceipt.getByTestId("chat-plan-disclosure")).toBeVisible();

	await setTodoView(page, "side-tool");
	await expect(todoGroup(page)).toHaveAttribute("data-group-id", manualGroupId);
	await expect(page.getByTestId("tab-todos")).toHaveAttribute("data-active", "true");
	await expect(headerReceipt.getByTestId("chat-plan-disclosure")).toHaveCount(0);

	await page.getByTestId("tab-todos").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Close", exact: true }).click();
	await expect(page.getByTestId("tab-todos")).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);
	await expect(headerReceipt).toBeVisible();
	await expect(page.getByTestId("tab-todos")).toHaveCount(0);
	await expect(headerReceipt.getByTestId("chat-plan-disclosure")).toHaveCount(0);
	await headerReceipt.click();
	await expect(todoGroup(page)).toHaveAttribute("data-group-id", manualGroupId);
	await expect(page.getByTestId("tab-todos")).toHaveAttribute("data-active", "true");

	const todoPanel = page.getByTestId("todo-panel");
	await expect(todoPanel).toHaveAttribute("data-session-id", chat1Id);
	await todoPanel.getByTestId("todo-add-input").fill("First chat task");
	await todoPanel.getByTestId("todo-add-input").press("Enter");
	const firstChatRow = todoPanel.getByTestId("todo-row").filter({ hasText: "First chat task" });
	await expect(firstChatRow).toBeVisible();

	await todoPanel.getByTestId("todo-open-plan").click();
	const planTab = page.locator('[data-testid="editor-tab"][data-kind="plan"]');
	await expect(planTab).toHaveAttribute("data-active", "true");
	const planPane = page.getByTestId("plan-pane");
	await expect(
		planPane.getByTestId("plan-item").filter({ hasText: "First chat task" }),
	).toBeVisible();
	await expect(todoPanel).toHaveAttribute("data-session-id", chat1Id);

	holdTodoReads = true;
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs(page)).toHaveCount(2);
	const sessionIds = await chatTabs(page).evaluateAll((tabs) =>
		tabs.map((tab) => tab.getAttribute("data-session-id")),
	);
	const chat2Id = sessionIds.find((sessionId) => sessionId !== null && sessionId !== chat1Id);
	if (!chat2Id) throw new Error("new chat has no distinct session id");
	await expect(chatTab(page, chat2Id)).toHaveAttribute("data-active", "true");
	await expect(todoPanel).toHaveAttribute("data-session-id", chat2Id);
	await expect(todoPanel.getByTestId("skeleton-rows")).toBeVisible();
	await expect(firstChatRow).toHaveCount(0);
	await releaseTodoReads(chat2Id);
	await expect(todoPanel).toContainText("No TODOs yet");
	await expect(todoPanel.getByTestId("skeleton-rows")).toHaveCount(0);

	await planTab.getByRole("tab").click();
	await expect(
		planPane.getByTestId("plan-item").filter({ hasText: "First chat task" }),
	).toBeVisible();
	await expect(todoPanel).toHaveAttribute("data-session-id", chat2Id);

	const chat2 = chatTab(page, chat2Id);
	await chat2.getByRole("tab").click();
	await expect(chat2).toHaveAttribute("data-active", "true");
	await expect(todoPanel).toHaveAttribute("data-session-id", chat2Id);
	await chat2.hover();
	await chat2.getByTestId("editor-tab-close").click();
	await expect(chat2).toHaveCount(0);
	await expect(todoPanel).toHaveAttribute("data-session-id", chat2Id);
	await expect(todoPanel).toContainText("No TODOs yet");

	await page.getByTestId("chat-history").first().click();
	await expect(
		page.locator(`[data-testid="closed-chat-item"][data-session-id="${chat2Id}"]`),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("tab-todos")).toBeVisible();
	await expect(todoGroup(page)).toHaveAttribute("data-group-id", manualGroupId);
	await expect(todoPanel).toHaveAttribute("data-session-id", chat2Id);
	await expect(todoPanel).toContainText("No TODOs yet");

	const reloadedChat2 = chatTab(page, chat2Id);
	await expect(reloadedChat2).toBeVisible();
	await reloadedChat2.hover();
	await reloadedChat2.getByTestId("editor-tab-close").click();
	await expect(reloadedChat2).toHaveCount(0);
	await expect(todoPanel).toHaveAttribute("data-session-id", chat2Id);

	await page.getByTestId("chat-history").first().click();
	const chat2HistoryItem = page.locator(
		`[data-testid="closed-chat-item"][data-session-id="${chat2Id}"]`,
	);
	const chat2HistoryRow = page.getByTestId("closed-chat-row").filter({ has: chat2HistoryItem });
	await chat2HistoryRow.getByTestId("closed-chat-delete").click();
	await expect(todoPanel).toContainText("Focus a chat to see its TODO list");
	await expect(todoPanel).not.toHaveAttribute("data-session-id", /.+/);
	await expect(page.getByTestId("tab-todos")).toBeVisible();
	await expect(todoGroup(page)).toHaveAttribute("data-group-id", manualGroupId);

	await chatTab(page, chat1Id).getByRole("tab").click();
	await expect(todoPanel).toHaveAttribute("data-session-id", chat1Id);
	await expect(firstChatRow).toBeVisible();
});
