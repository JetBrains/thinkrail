import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_800_000_000;
const DONE_CHAT = "attention done chat";
const FAILED_CHAT = "attention failed chat";
const WAITING_CHAT = "attention waiting chat";

function seedDoneChat(worktree: string): void {
	seedWorkspaceSession(worktree, {
		name: DONE_CHAT,
		messages: [
			{ role: "user", text: "clean things up", timestamp: BASE_TS + 20_000 },
			{ role: "assistant", text: "all done", timestamp: BASE_TS + 21_000, stopReason: "stop" },
		],
	});
}

function seedFailedChat(worktree: string): void {
	seedWorkspaceSession(worktree, {
		name: FAILED_CHAT,
		messages: [
			{ role: "user", text: "ship the release", timestamp: BASE_TS + 15_000 },
			{
				role: "assistant",
				text: "I was preparing the release",
				timestamp: BASE_TS + 16_000,
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
						id: "tc-attention-1",
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
				toolCallId: "tc-attention-1",
				toolName: "ask_user_question",
				content: [{ type: "text", text: "Questions shown to the user." }],
				details: { kind: "ack" },
				isError: false,
			},
		],
	});
}

async function reloadAttention(page: Page): Promise<void> {
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

test("a completed chat needs attention after reload and clears once its conversation is visible", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedDoneChat(realpathSync(E2E_FIXTURE_REPO));
	await reloadAttention(page);

	const row = defaultWorkspaceRow(page);
	await expect(row).toHaveAttribute("data-attention", "true");
	await expect(row.getByTestId("attention-dot")).toHaveAttribute("aria-label", "Needs attention");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);

	await enterDefaultWorkspace(page);
	await expect(page.getByTestId("chat-view")).toBeVisible();
	await expect(row).not.toHaveAttribute("data-attention", /.+/);
	await shot(page.getByTestId("project-tree"), "attention", "workspace-cleared");
});

test("a failed chat uses the same attention dot and clears by the same review gesture", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedFailedChat(realpathSync(E2E_FIXTURE_REPO));
	await reloadAttention(page);

	const row = defaultWorkspaceRow(page);
	await expect(row).toHaveAttribute("data-attention", "true");
	await expect(row.getByTestId("attention-dot")).toHaveAttribute("aria-label", "Needs attention");

	await enterDefaultWorkspace(page);
	await expect(page.getByText("provider unreachable")).toBeVisible();
	await expect(row).not.toHaveAttribute("data-attention", /.+/);
});

test("a question survives viewing and is located on its tab and closed-history row", async ({
	page,
}) => {
	await openFixtureProject(page);
	const worktree = realpathSync(E2E_FIXTURE_REPO);
	seedWaitingChat(worktree);
	seedDoneChat(worktree);
	await reloadAttention(page);

	const row = defaultWorkspaceRow(page);
	await expect(row).toHaveAttribute("data-attention", "true");
	await enterDefaultWorkspace(page);
	await expect(page.getByTestId("chat-view")).toBeVisible();
	await expect(row).toHaveAttribute("data-attention", "true");

	const history = page.getByTestId("chat-history").first();
	await expect(history).toHaveAttribute("data-attention", "true");
	await history.click();
	const waitingHistoryRow = page.getByTestId("closed-chat-row").filter({ hasText: WAITING_CHAT });
	await expect(waitingHistoryRow).toHaveAttribute("data-attention", "true");
	await expect(waitingHistoryRow.getByTestId("attention-dot")).toHaveAttribute(
		"aria-label",
		"Needs attention",
	);
	await waitingHistoryRow.getByTestId("closed-chat-item").click();

	const waitingTab = page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.filter({ hasText: WAITING_CHAT });
	await expect(waitingTab.getByTestId("attention-dot")).toHaveAttribute(
		"aria-label",
		"Needs attention",
	);
	await expect(page.getByText("Which database should we use?")).toBeVisible();
	await expect(row).toHaveAttribute("data-attention", "true");

	await waitingTab.getByTestId("editor-tab-close").click();
	await history.click();
	const closedWaiting = page.getByTestId("closed-chat-row").filter({ hasText: WAITING_CHAT });
	await expect(closedWaiting).toHaveAttribute("data-attention", "true");
	await closedWaiting.getByTestId("closed-chat-delete").click();
	await expect(row).not.toHaveAttribute("data-attention", /.+/);
});

test("a collapsed project rolls up attention only while its workspace rows are hidden", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedFailedChat(realpathSync(E2E_FIXTURE_REPO));
	await reloadAttention(page);

	const project = page.getByTestId("project-item").first();
	const expand = project.getByTestId("project-expand");
	await expect(expand).toHaveAttribute("data-expanded", "true");
	await expect(project).not.toHaveAttribute("data-attention", /.+/);

	await expand.click();
	await expect(expand).toHaveAttribute("data-expanded", "false");
	await expect(project).toHaveAttribute("data-attention", "true");
	await expect(project.getByTestId("attention-dot")).toHaveAttribute(
		"aria-label",
		"Needs attention",
	);
	await shot(page.getByTestId("project-tree"), "attention", "project-collapsed");

	await expand.click();
	await expect(project).not.toHaveAttribute("data-attention", /.+/);
});
