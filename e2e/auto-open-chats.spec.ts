import { existsSync, mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { TodoStore } from "pi-todos/core";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

// Auto-open on workspace entry: `WorkspaceWorkbench`'s hydrate-on-activate no longer sends every disk-only
// session to history. A disk chat with unfinished TODO items (the `SessionSummary.openTodos` decoration,
// counted host-side from `.thinkrail/context/todos/<sessionId>.json`) auto-opens as a tab — work in
// progress must survive a host restart as an open chat, not a history entry. And when nothing at all
// would open, the most recent disk chat opens as a fallback, so the center is never empty when the
// workspace has any chat. Both paths are driven here through the built-in Default workspace, the one
// workspace that enters with zero live sessions (a dialog-created worktree always starts a live chat).
//
// Also covered: an opened transcript starts scrolled to its *latest* message (`initialTopMostItemIndex`
// on the chat Virtuoso) — the long seeded transcript's last line must be in view without any scrolling.

/** Deterministic timestamps so "most recent" is assertable (summaries order by the session file mtime). */
const BASE_TS = 1_700_200_000_000;

/** The Default workspace's cwd as the HOST records it: project registration canonicalizes the picked
 * path via `git rev-parse --show-toplevel` (`/tmp` → `/private/tmp` on macOS), and pi keys session
 * dirs by that exact cwd string — a seed at the uncanonicalized path would land in a different
 * encoded dir and never be listed. */
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

/** Pin a seeded session file's mtime (summaries derive `updatedAt` from it, not from message timestamps). */
function setMtime(path: string, ms: number): void {
	utimesSync(path, new Date(ms), new Date(ms));
}

/** Seed an unfinished TODO for a session under the fixture repo (the Default workspace's worktree),
 * with the scratch dir's `*` .gitignore so the seed leaves zero git footprint (mirrors
 * `ensureWorkspaceScratchDir` — the host normally seeds it on session create). */
function seedOpenTodo(sessionId: string, title: string): void {
	const contextDir = join(repoCwd(), ".thinkrail", "context");
	mkdirSync(contextDir, { recursive: true });
	writeFileSync(join(contextDir, ".gitignore"), "*\n");
	new TodoStore(repoCwd(), sessionId).add({ title });
}

// The seeded scratch dir is gitignored (zero footprint), but sweep it anyway so no later spec ever meets
// a leftover todo file in the shared fixture repo (`resetState` clears sessions, not the worktree dir).
test.afterEach(() => {
	rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
});

test("a disk chat with unfinished TODOs auto-opens (scrolled to its latest message); the rest go to history", async ({
	page,
}) => {
	await openFixtureProject(page); // resets state — seed after, enter after that

	// Older session, but it carries an open TODO → must auto-open. Long transcript: the last message is
	// only in view if the chat opened at the bottom.
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

	// Newer session without TODOs → history, despite being the most recent.
	const doneChat = seedWorkspaceSession(repoCwd(), {
		name: "release notes chat",
		messages: [{ role: "user", text: "ship the release notes", timestamp: BASE_TS + 100_000 }],
	});
	setMtime(doneChat.path, BASE_TS + 100_000);

	await enterDefaultWorkspace(page);

	// Exactly the TODO-carrying chat opened (and holds focus — its transcript is on screen, no receipt).
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTabs).toHaveCount(1);
	await expect(page.getByTestId("workspace-ready")).toHaveCount(0);
	// Opened at the bottom: the transcript's final message is in view without any scrolling.
	await expect(page.getByText("stopped before the final verification pass")).toBeVisible();

	// The TODO-less newer chat went to history, reopenable on demand.
	await page.getByTestId("chat-history").click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "release notes chat" }),
	).toHaveCount(1);
});

test("a closed chat can be moved to trash from history", async ({ page }) => {
	await openFixtureProject(page);

	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "trash this chat",
		messages: [{ role: "user", text: "remove this transcript", timestamp: BASE_TS }],
	});
	setMtime(doomed.path, BASE_TS);
	const searchDoomed = seedWorkspaceSession(repoCwd(), {
		name: "search trash chat",
		messages: [{ role: "user", text: "delete this from search", timestamp: BASE_TS + 10_000 }],
	});
	setMtime(searchDoomed.path, BASE_TS + 10_000);
	const kept = seedWorkspaceSession(repoCwd(), {
		name: "keep this chat",
		messages: [{ role: "user", text: "keep this transcript", timestamp: BASE_TS + 50_000 }],
	});
	setMtime(kept.path, BASE_TS + 50_000);

	await enterDefaultWorkspace(page);
	await expect(page.getByText("keep this transcript")).toBeVisible();
	await page.getByTestId("chat-history").click();
	const row = page.getByTestId("closed-chat-row").filter({ hasText: "trash this chat" });
	await row.getByTestId("closed-chat-delete").click();

	await expect.poll(() => existsSync(doomed.path)).toBe(false);
	await page.getByTestId("chat-history").click();
	await expect(
		page.getByTestId("closed-chat-row").filter({ hasText: "trash this chat" }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByText("remove this transcript")).toHaveCount(0);

	await page.getByTestId("chat-input").press("Control+r");
	await page.getByTestId("history-query").fill("delete this from search");
	const searchRow = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "delete this from search" });
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
	await page2.getByTestId("project-expand").first().click();
	await defaultWorkspaceRow(page2).click();
	await expect(page2.getByText("shared doomed transcript")).toBeVisible();

	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").click();
	const row = page.getByTestId("closed-chat-row").filter({ hasText: "shared doomed chat" });
	await row.getByTestId("closed-chat-delete").click();

	await expect.poll(() => existsSync(doomed.path)).toBe(false);
	await expect(page2.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(page2.getByTestId("workspace-ready")).toBeVisible();
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

	// A separate browser context can lose network independently while the first client performs the delete.
	// Chromium's offline emulation does not close an already-open WebSocket, so retain that socket from an
	// init script: after network is blocked the test closes it explicitly, preventing its automatic retry
	// from reconnecting until the context comes back online.
	const context2 = await browser.newContext();
	await context2.addInitScript(() => {
		const NativeWebSocket = window.WebSocket;
		class TrackedWebSocket extends NativeWebSocket {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				Object.defineProperty(window, "__thinkrailE2eSocket", {
					configurable: true,
					value: this,
				});
			}
		}
		window.WebSocket = TrackedWebSocket;
	});
	const page2 = await context2.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page2.getByTestId("project-expand").first().click();
	await defaultWorkspaceRow(page2).click();
	await expect(page2.getByText("offline doomed transcript")).toBeVisible();

	await context2.setOffline(true);
	await page2.evaluate(() => {
		const socket = Object.getOwnPropertyDescriptor(window, "__thinkrailE2eSocket")?.value;
		if (socket instanceof WebSocket) socket.close();
	});
	await expect(page2.getByTestId("connection-status")).toHaveAttribute(
		"data-status",
		"disconnected",
	);

	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").click();
	await page
		.getByTestId("closed-chat-row")
		.filter({ hasText: "offline doomed chat" })
		.getByTestId("closed-chat-delete")
		.click();
	await expect.poll(() => existsSync(doomed.path)).toBe(false);

	await context2.setOffline(false);
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page2.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(page2.getByTestId("workspace-ready")).toBeVisible();
	await context2.close();
});

test("with no TODOs anywhere, the most recent disk chat opens as the fallback", async ({
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

	// The newest chat opened (never an empty center when the workspace has chats); the older one stayed
	// in history.
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTabs).toHaveCount(1);
	await expect(page.getByText("the newest fallback chat")).toBeVisible();
	await page.getByTestId("chat-history").click();
	await expect(
		page.getByTestId("closed-chat-item").filter({ hasText: "older fallback chat" }),
	).toHaveCount(1);
});
