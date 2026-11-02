import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

interface ClientFrame {
	id?: string;
	method?: string;
}

async function acceptPromptsWithoutAgent(page: Page): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const frame = JSON.parse(String(message)) as ClientFrame;
			if (frame.id && frame.method === "session.prompt") {
				ws.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

async function sendPrompt(page: Page, text: string): Promise<void> {
	const input = page.getByTestId("chat-input");
	await input.fill(text);
	await input.press("Enter");
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]').last()).toContainText(
		text,
	);
}

test("the fifth prompt asks for a GitHub star once and the action opens the repo", async ({
	page,
	context,
}) => {
	await acceptPromptsWithoutAgent(page);
	await context.route("https://github.com/**", (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "" }),
	);
	await openWorkspaceChat(page);

	const ask = page.getByTestId("toast").filter({ hasText: "Enjoying ThinkRail?" });
	for (const n of [1, 2, 3, 4]) {
		await sendPrompt(page, `prompt ${n}`);
		await expect(ask).toHaveCount(0);
	}

	await sendPrompt(page, "prompt 5");
	await expect(ask).toBeVisible();

	const [popup] = await Promise.all([
		context.waitForEvent("page"),
		ask.getByTestId("toast-action").click(),
	]);
	expect(popup.url()).toBe("https://github.com/JetBrains/thinkrail");
	await popup.close();
	await expect(ask).toHaveCount(0);

	await sendPrompt(page, "prompt 6");
	await expect(ask).toHaveCount(0);
});
