import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

interface ClientFrame {
	method?: string;
	params?: { instructions?: string; text?: string };
}

async function observeClientFrames(page: Page, frames: ClientFrame[]): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			try {
				frames.push(JSON.parse(raw) as ClientFrame);
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

test("/compact is discoverable and routes instructions without creating a user turn", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	await input.fill("/comp");
	const row = page.locator('[data-testid="slash-command"][data-source="builtin"]');
	await expect(row).toHaveCount(1);
	await expect(row).toContainText("/compact");
	await expect(row).toContainText("optional instructions");
	await expect(row).toContainText("Pi/built-in");
	await input.press("Tab");
	await expect(input).toHaveValue("/compact ");

	await input.fill("/compact preserve exact filenames");
	const userTurns = page.locator('[data-testid="chat-message"][data-role="user"]');
	const userCount = await userTurns.count();
	await page.getByTestId("chat-send").click();

	await expect(input).toHaveValue("");
	const notice = page.getByTestId("compaction-notice");
	await expect(notice).toHaveCount(1, { timeout: 15_000 });
	await expect(notice).toHaveAttribute("data-status", "failed");
	await expect(userTurns).toHaveCount(userCount);
	await expect
		.poll(() => frames.find((frame) => frame.method === "session.compact")?.params?.instructions)
		.toBe("preserve exact filenames");

	const methods = frames.flatMap((frame) => (frame.method ? [frame.method] : []));
	expect(methods.indexOf("session.clearQueue")).toBeLessThan(methods.indexOf("session.compact"));
	expect(
		frames.some(
			(frame) => frame.method === "session.prompt" && frame.params?.text?.startsWith("/compact"),
		),
	).toBe(false);
});
