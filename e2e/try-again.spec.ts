import { realpathSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openChatFromHistory, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_700_000_000;

interface ClientFrame {
	id?: string;
	method?: string;
	params?: { sessionId?: string; text?: string; images?: unknown[] };
}

async function interceptTryAgain(page: Page, prompts: ClientFrame[]): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: ClientFrame;
			try {
				frame = JSON.parse(raw) as ClientFrame;
			} catch {
				server.send(message);
				return;
			}
			if (frame.id && frame.method === "session.prompt" && frame.params?.text === "Try again.") {
				prompts.push(frame);
				ws.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

test("a final agent failure offers Try again as an ordinary visible prompt", async ({ page }) => {
	const prompts: ClientFrame[] = [];
	await interceptTryAgain(page, prompts);
	await openFixtureProject(page);

	const chat = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "network failure chat",
		messages: [
			{ role: "user", text: "finish the task", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "I was checking the final step",
				timestamp: BASE_TS + 1_000,
				stopReason: "error",
				errorMessage: "fetch failed",
			},
		],
	});

	await enterDefaultWorkspace(page);
	await openChatFromHistory(page, "network failure chat");

	const failure = page
		.locator('[data-testid="chat-message"][data-role="error"]')
		.filter({ hasText: "fetch failed" });
	await expect(failure).toBeVisible();
	const tryAgain = failure.getByTestId("agent-try-again");
	await expect(tryAgain).toHaveText("Try again");

	await tryAgain.click();

	await expect(page.getByTestId("agent-try-again")).toHaveCount(0);
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "Try again." }),
	).toHaveCount(1);
	await expect
		.poll(() => prompts.at(-1)?.params)
		.toEqual({ sessionId: chat.id, text: "Try again." });
	expect(prompts).toHaveLength(1);
});
