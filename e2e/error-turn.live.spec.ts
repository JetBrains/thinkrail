import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

const BOGUS_MODEL_ID = "definitely-not-a-real-model-9x";

interface WireFrame {
	method?: string;
	params?: { model?: Record<string, unknown> };
}

async function forceBadModelOnCreate(page: Page): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: WireFrame;
			try {
				frame = JSON.parse(raw) as WireFrame;
			} catch {
				server.send(message);
				return;
			}
			if (frame.method === "session.create" && frame.params?.model) {
				frame.params.model = { ...frame.params.model, id: BOGUS_MODEL_ID, name: "Bogus 9x" };
				server.send(JSON.stringify(frame));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

test("a bad model surfaces a visible error toast, not a false ✓ Done", {
	tag: "@agent",
}, async ({ page }) => {
	await forceBadModelOnCreate(page);
	await openFixtureProject(page);

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("model-selector")).not.toContainText("Default model");
	await page.getByTestId("ws-prompt").fill("Reply with the single word: pong");
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	const toast = page.locator('[data-testid="toast"][data-variant="error"]');
	await expect(toast).toBeVisible({ timeout: 15_000 });
	await expect(toast).toContainText("Couldn't start the chat");
	await expect(toast).toContainText(BOGUS_MODEL_ID);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toHaveCount(0);
});
