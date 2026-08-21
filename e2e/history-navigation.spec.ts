import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, goProjectHome, openFixtureProject } from "./fixtures/app";

const chatTabs = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="chat"]');
const currentHash = (page: Page) => page.evaluate(() => window.location.hash);

async function openTwoChats(page: Page): Promise<{ chat1Hash: string; chat2Hash: string }> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(chatTabs(page)).toHaveCount(1);
	await expect.poll(() => currentHash(page)).toContain("/chats/");
	const chat1Hash = await currentHash(page);

	await page.getByTestId("new-chat").click();
	await expect(chatTabs(page)).toHaveCount(2);
	await expect.poll(() => currentHash(page)).not.toBe(chat1Hash);
	const chat2Hash = await currentHash(page);
	expect(chat2Hash).toContain("/chats/");
	return { chat1Hash, chat2Hash };
}

test("Back and Forward step through chat switches and scope moves", async ({ page }) => {
	const { chat1Hash, chat2Hash } = await openTwoChats(page);

	await chatTabs(page).first().getByRole("tab").click();
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);

	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat2Hash);
	await expect(chatTabs(page).last()).toHaveAttribute("data-active", "true");

	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");

	await page.goForward();
	await expect.poll(() => currentHash(page)).toBe(chat2Hash);
	await expect(chatTabs(page).last()).toHaveAttribute("data-active", "true");
	await page.goForward();
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");

	await goProjectHome(page);
	await expect.poll(() => currentHash(page)).not.toContain("/workspaces/");
	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");
});

test("Back returns to a deep-linked chat entry", async ({ page }) => {
	const { chat1Hash, chat2Hash } = await openTwoChats(page);

	await page.goto("about:blank");
	await page.goto(`/${chat1Hash}`);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");

	await chatTabs(page).last().getByRole("tab").click();
	await expect.poll(() => currentHash(page)).toBe(chat2Hash);
	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");
});

test("Back to a just-closed chat wins over the close's delayed layout acceptance", async ({
	page,
}) => {
	const holds = new Map<string, { requestId: string | null; response: string | null }>();
	let sendHeld: ((raw: string) => void) | null = null;
	const arm = (method: string) => holds.set(method, { requestId: null, response: null });
	const release = (method: string) => {
		const hold = holds.get(method);
		holds.delete(method);
		if (hold?.response) sendHeld?.(hold.response);
	};
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		sendHeld = (raw) => ws.send(raw);
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			try {
				const frame = JSON.parse(raw) as { id?: string; method?: string };
				const hold = frame.method ? holds.get(frame.method) : undefined;
				if (hold && hold.requestId === null && frame.id) hold.requestId = frame.id;
			} catch {}
			server.send(raw);
		});
		server.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			try {
				const frame = JSON.parse(raw) as { id?: string };
				for (const hold of holds.values()) {
					if (frame.id && frame.id === hold.requestId && hold.response === null) {
						hold.response = raw;
						return;
					}
				}
			} catch {}
			ws.send(raw);
		});
	});

	const { chat1Hash, chat2Hash } = await openTwoChats(page);

	arm("layout.replace");
	await chatTabs(page).last().getByTestId("editor-tab-close").click();
	await expect(chatTabs(page)).toHaveCount(1);
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);

	arm("session.list");
	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat2Hash);
	release("layout.replace");
	await page.waitForTimeout(100);
	release("session.list");

	await expect(chatTabs(page)).toHaveCount(2);
	await expect(chatTabs(page).last()).toHaveAttribute("data-active", "true");
	await expect.poll(() => currentHash(page)).toBe(chat2Hash);
});

test("a closed chat's entry survives Back; a deleted chat's entry falls back", async ({ page }) => {
	const { chat1Hash, chat2Hash } = await openTwoChats(page);

	await chatTabs(page).last().getByTestId("editor-tab-close").click();
	await expect(chatTabs(page)).toHaveCount(1);
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);

	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat2Hash);
	await expect(chatTabs(page)).toHaveCount(2);
	await expect(chatTabs(page).last()).toHaveAttribute("data-active", "true");

	await chatTabs(page).last().getByTestId("editor-tab-close").click();
	await expect(chatTabs(page)).toHaveCount(1);
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-row").first().getByTestId("closed-chat-delete").click();
	await expect(page.getByTestId("closed-chat-row")).toHaveCount(0);
	await page.keyboard.press("Escape");

	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await expect(chatTabs(page)).toHaveCount(1);
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");
});
