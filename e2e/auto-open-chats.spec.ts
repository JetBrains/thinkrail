import { mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { TodoStore } from "pi-todos/core";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

// Auto-open on workspace entry: `CenterTabs`' hydrate-on-activate no longer sends every disk-only
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
