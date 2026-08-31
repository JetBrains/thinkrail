import { mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { TodoStore } from "pi-todos/core";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_400_000_000;

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

function seedOpenTodo(sessionId: string, title: string): void {
	const contextDir = join(repoCwd(), ".thinkrail", "context");
	mkdirSync(contextDir, { recursive: true });
	writeFileSync(join(contextDir, ".gitignore"), "*\n");
	new TodoStore(repoCwd(), sessionId).add({ title });
}

async function failGetMessagesFor(page: Page, sessionId: () => string): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			let frame: { id?: string; method?: string; params?: { sessionId?: string } };
			try {
				frame = JSON.parse(raw) as typeof frame;
			} catch {
				server.send(message);
				return;
			}
			if (
				frame.method === "session.getMessages" &&
				frame.id &&
				frame.params?.sessionId === sessionId()
			) {
				ws.send(JSON.stringify({ id: frame.id, ok: false, error: "transcript read failed" }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

test.afterEach(() => {
	rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
});

test("a transcript that fails to load says so and stays in history", async ({ page }) => {
	let unreadableId = "";
	await failGetMessagesFor(page, () => unreadableId);
	await openFixtureProject(page);

	const unreadable = seedWorkspaceSession(repoCwd(), {
		name: "the unreadable chat",
		messages: [{ role: "user", text: "cannot load me", timestamp: BASE_TS }],
	});
	unreadableId = unreadable.id;
	utimesSync(unreadable.path, new Date(BASE_TS), new Date(BASE_TS));
	seedOpenTodo(unreadable.id, "finish the unreadable work");

	const readable = seedWorkspaceSession(repoCwd(), {
		name: "the readable chat",
		messages: [{ role: "user", text: "load me fine", timestamp: BASE_TS + 1_000 }],
	});
	utimesSync(readable.path, new Date(BASE_TS + 1_000), new Date(BASE_TS + 1_000));
	seedOpenTodo(readable.id, "finish the readable work");

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);

	await openChatFromHistory(page, "the readable chat");
	await expect(page.getByText("load me fine")).toBeVisible();

	await openChatFromHistory(page, "the unreadable chat");
	await expect(
		page
			.locator('[data-testid="toast"][data-variant="error"]')
			.filter({ hasText: "transcript read failed" }),
	).toBeVisible();
	await page.getByTestId("chat-history").first().click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "the unreadable chat" }),
	).toHaveCount(1);
});

test("a failed never-empty fallback keeps its chat reachable too", async ({ page }) => {
	let onlyId = "";
	await failGetMessagesFor(page, () => onlyId);
	await openFixtureProject(page);

	const only = seedWorkspaceSession(repoCwd(), {
		name: "the only chat",
		messages: [{ role: "user", text: "the only transcript", timestamp: BASE_TS }],
	});
	onlyId = only.id;
	utimesSync(only.path, new Date(BASE_TS), new Date(BASE_TS));

	await expect(defaultWorkspaceRow(page)).toBeVisible();
	await enterDefaultWorkspace(page);

	await openChatFromHistory(page, "the only chat");
	await expect(
		page
			.locator('[data-testid="toast"][data-variant="error"]')
			.filter({ hasText: "transcript read failed" }),
	).toBeVisible();

	await page.getByTestId("start-chat").first().click();
	await page.getByTestId("chat-history").first().click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "the only chat" }),
	).toHaveCount(1);
});
