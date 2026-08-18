import { mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { TodoStore } from "pi-todos/core";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

// A hydrate read that fails used to be swallowed: no tab, no history entry, no notice — indistinguishable
// from a workspace that simply has no such chat. That is what made a missing transcript undiagnosable, so
// the failure now says so and the chat it could not open stays reachable from history.

const BASE_TS = 1_700_400_000_000;

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

/** Auto-open needs a reason: an unfinished TODO is the one that works for a disk-only chat. */
function seedOpenTodo(sessionId: string, title: string): void {
	const contextDir = join(repoCwd(), ".thinkrail", "context");
	mkdirSync(contextDir, { recursive: true });
	writeFileSync(join(contextDir, ".gitignore"), "*\n");
	new TodoStore(repoCwd(), sessionId).add({ title });
}

/** Fail `session.getMessages` for ONE session, relaying every other frame verbatim (the regex and the
 * relay mirror `error-turn.live.spec.ts` — a glob would stop matching the `?client=` suffix). */
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
	// Ahead of the first navigation: `routeWebSocket` only claims sockets opened after it is installed.
	await failGetMessagesFor(page, () => unreadableId);
	await openFixtureProject(page); // resets state — seed after

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

	// One of the two auto-opens failed: the other still hydrated…
	await expect(page.getByText("load me fine")).toBeVisible();
	// …the failure is named rather than swallowed…
	await expect(
		page
			.locator('[data-testid="toast"][data-variant="error"]')
			.filter({ hasText: "transcript read failed" }),
	).toBeVisible();

	// …and the chat that could not open is reachable for a retry instead of gone.
	await page.getByTestId("chat-history").click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "the unreadable chat" }),
	).toHaveCount(1);
});

// The never-empty fallback: a workspace whose only chat is an ordinary disk chat opens it without any
// TODO to justify it. That summary leaves `toHistory` before its read, so a failure has to put it back —
// or the one chat the workspace has would be in neither list and reachable from nowhere.
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

	await expect(
		page
			.locator('[data-testid="toast"][data-variant="error"]')
			.filter({ hasText: "transcript read failed" }),
	).toBeVisible();

	// Nothing opened, so the history list is only reachable once a chat exists — but the entry is there.
	await page.getByTestId("start-chat").click();
	await page.getByTestId("chat-history").click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "the only chat" }),
	).toHaveCount(1);
});
