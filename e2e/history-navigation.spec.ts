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

	await page.getByTestId("new-chat").first().click();
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

test("Back reopens a just-closed local chat without a current-layout wire write", async ({
	page,
}) => {
	const methods: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			try {
				const frame = JSON.parse(raw) as { method?: string };
				if (frame.method) methods.push(frame.method);
			} catch {}
			server.send(raw);
		});
		server.onMessage((message) => ws.send(message));
	});

	const { chat1Hash, chat2Hash } = await openTwoChats(page);
	methods.length = 0;
	await chatTabs(page).last().getByTestId("editor-tab-close").click();
	await expect(chatTabs(page)).toHaveCount(1);
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	expect(methods).not.toContain("layout.replace");

	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat2Hash);
	await expect(chatTabs(page)).toHaveCount(2);
	await expect(chatTabs(page).last()).toHaveAttribute("data-active", "true");
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
	await page.getByTestId("chat-history").first().click();
	await page.getByTestId("closed-chat-row").first().getByTestId("closed-chat-delete").click();
	await expect(page.getByTestId("closed-chat-row")).toHaveCount(0);
	await page.keyboard.press("Escape");

	await page.goBack();
	await expect.poll(() => currentHash(page)).toBe(chat1Hash);
	await expect(chatTabs(page)).toHaveCount(1);
	await expect(chatTabs(page).first()).toHaveAttribute("data-active", "true");
});
