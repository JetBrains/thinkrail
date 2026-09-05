import { realpathSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	goProjectHome,
	openFixtureProject,
	openPersistedChat,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_800_000_000;

const FAILED_CHAT = "activity failed chat";
const WAITING_CHAT = "activity waiting chat";

function seedFailedChat(worktree: string): void {
	seedWorkspaceSession(worktree, {
		name: FAILED_CHAT,
		messages: [
			{ role: "user", text: "ship the release", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "I was preparing the release",
				timestamp: BASE_TS + 1_000,
				stopReason: "error",
				errorMessage: "provider unreachable",
			},
		],
	});
}

function seedWaitingChat(worktree: string): void {
	seedWorkspaceSession(worktree, {
		name: WAITING_CHAT,
		messages: [
			{ role: "user", text: "pick a database", timestamp: BASE_TS + 10_000 },
			{
				role: "assistant",
				timestamp: BASE_TS + 11_000,
				stopReason: "toolUse",
				content: [
					{
						type: "toolCall",
						id: "tc-activity-1",
						name: "ask_user_question",
						arguments: {
							questions: [
								{
									question: "Which database should we use?",
									header: "DB",
									options: [
										{ label: "Postgres", description: "relational" },
										{ label: "SQLite", description: "embedded" },
									],
								},
							],
						},
					},
				],
			},
			{
				role: "toolResult",
				timestamp: BASE_TS + 12_000,
				toolCallId: "tc-activity-1",
				toolName: "ask_user_question",
				content: [{ type: "text", text: "Questions shown to the user." }],
				details: { kind: "ack" },
				isError: false,
			},
		],
	});
}

test("a failed run marks its workspace row, and the mark outlives both the tab and the workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	const row = defaultWorkspaceRow(page);
	await expect(row).not.toHaveAttribute("data-activity", /.+/);

	seedFailedChat(realpathSync(E2E_FIXTURE_REPO));
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, FAILED_CHAT);

	await expect(row).toHaveAttribute("data-activity", "failed");
	await expect(row.getByTestId("activity-glyph")).toHaveAttribute("aria-label", "Last run failed");
	await shot(page.getByTestId("project-tree"), "activity", "workspace-failed");

	const chatTab = page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.filter({ hasText: FAILED_CHAT });
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await expect(row).toHaveAttribute("data-activity", "failed");

	await goProjectHome(page);
	await expect(row).toHaveAttribute("data-activity", "failed");
});

test("an unanswered question marks the row as waiting for you", async ({ page }) => {
	await openFixtureProject(page);
	seedWaitingChat(realpathSync(E2E_FIXTURE_REPO));
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, WAITING_CHAT);

	const row = defaultWorkspaceRow(page);
	await expect(row).toHaveAttribute("data-activity", "waiting");
	await expect(row.getByTestId("activity-glyph")).toHaveAttribute(
		"aria-label",
		"Waiting for your answer",
	);
	await shot(page.getByTestId("project-tree"), "activity", "workspace-waiting");
});

test("failed outranks waiting in one workspace, and the glyph names the whole breakdown", async ({
	page,
}) => {
	await openFixtureProject(page);
	const worktree = realpathSync(E2E_FIXTURE_REPO);
	seedFailedChat(worktree);
	seedWaitingChat(worktree);

	await enterDefaultWorkspace(page);
	await openPersistedChat(page, WAITING_CHAT);
	await openPersistedChat(page, FAILED_CHAT);

	const row = defaultWorkspaceRow(page);
	await expect(row).toHaveAttribute("data-activity", "failed");
	await expect(row.getByTestId("activity-glyph")).toHaveAttribute(
		"aria-label",
		"1 chat failed, 1 chat waiting for your answer",
	);
	await shot(page.getByTestId("project-tree"), "activity", "workspace-rollup");
});

test("deleting the marked chat clears the row", async ({ page }) => {
	await openFixtureProject(page);
	seedFailedChat(realpathSync(E2E_FIXTURE_REPO));
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, FAILED_CHAT);

	const row = defaultWorkspaceRow(page);
	await expect(row).toHaveAttribute("data-activity", "failed");

	const chatTab = page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.filter({ hasText: FAILED_CHAT });
	await chatTab.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").first().click();
	const historyRow = page.getByTestId("closed-chat-row").filter({ hasText: FAILED_CHAT });
	await historyRow.getByTestId("closed-chat-delete").click();

	await expect(row).not.toHaveAttribute("data-activity", /.+/);
});

test("a collapsed project row carries the rollup, so activity survives folding the project away", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedFailedChat(realpathSync(E2E_FIXTURE_REPO));
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, FAILED_CHAT);

	const project = page.getByTestId("project-item").first();
	const expand = project.getByTestId("project-expand");
	await expect(expand).toHaveAttribute("data-expanded", "true");
	await expect(project).not.toHaveAttribute("data-activity", /.+/);

	await expand.click();
	await expect(expand).toHaveAttribute("data-expanded", "false");
	await expect(project).toHaveAttribute("data-activity", "failed");
	await expect(project.getByTestId("activity-glyph")).toHaveAttribute(
		"aria-label",
		"Last run failed",
	);
	await shot(page.getByTestId("project-tree"), "activity", "project-collapsed");

	await expand.click();
	await expect(project).not.toHaveAttribute("data-activity", /.+/);
});

test("a never-opened chat's failure reaches the rail from disk, without entering its workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedFailedChat(realpathSync(E2E_FIXTURE_REPO));

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const row = defaultWorkspaceRow(page);
	await expect(row).toHaveAttribute("data-activity", "failed");
	await expect(row.getByTestId("activity-glyph")).toHaveAttribute("aria-label", "Last run failed");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(row).not.toHaveAttribute("data-active", "true");
	await shot(page.getByTestId("project-tree"), "activity", "workspace-from-disk");
});
