import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { defaultWorkspaceRow, enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_800_000_000;
const DONE_CHAT = "attention done chat";
const FAILED_CHAT = "attention failed chat";
const INTERRUPTED_CHAT = "attention interrupted chat";
const WAITING_CHAT = "attention waiting chat";
const NEWER_WAITING_CHAT = "attention newer waiting chat";

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

function seedInterruptedChat(worktree: string): void {
	seedWorkspaceSession(worktree, {
		name: INTERRUPTED_CHAT,
		messages: [
			{ role: "user", text: "keep working through restart", timestamp: BASE_TS + 17_000 },
			{
				role: "assistant",
				text: "work was interrupted",
				timestamp: BASE_TS + 18_000,
				stopReason: "aborted",
			},
		],
	});
}

function seedWaitingChat(
	worktree: string,
	name = WAITING_CHAT,
	questionId = "tc-attention-1",
	baseOffset = 10_000,
): void {
	seedWorkspaceSession(worktree, {
		name,
		messages: [
			{ role: "user", text: "pick a database", timestamp: BASE_TS + baseOffset },
			{
				role: "assistant",
				timestamp: BASE_TS + baseOffset + 1_000,
				stopReason: "toolUse",
				content: [
					{
						type: "toolCall",
						id: questionId,
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
				timestamp: BASE_TS + baseOffset + 2_000,
				toolCallId: questionId,
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
	await expect(row.getByTestId("attention-dot")).toHaveAttribute(
		"aria-label",
		"Needs attention, F8 next, Shift+F8 previous",
	);
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
	await expect(row.getByTestId("attention-dot")).toHaveAttribute(
		"aria-label",
		"Needs attention, F8 next, Shift+F8 previous",
	);

	await enterDefaultWorkspace(page);
	await expect(page.getByText("provider unreachable")).toBeVisible();
	await expect(row).not.toHaveAttribute("data-attention", /.+/);
});

test("a host-interrupted chat becomes durable attention instead of stale running", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedInterruptedChat(realpathSync(E2E_FIXTURE_REPO));
	await reloadAttention(page);

	const row = defaultWorkspaceRow(page);
	await expect(row).not.toHaveAttribute("data-running", /.+/);
	await expect(row).toHaveAttribute("data-attention", "true");
	await expect(row.getByTestId("attention-dot")).toHaveAttribute(
		"aria-label",
		"Needs attention, F8 next, Shift+F8 previous",
	);

	await enterDefaultWorkspace(page);
	await expect(page.getByText("work was interrupted")).toBeVisible();
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
	await expect(history).toHaveAttribute("aria-label", "Reopen a closed chat — Needs attention");
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

test("F8 cycles cold blockers before normal attention and continues after viewed results clear", async ({
	page,
}) => {
	await openFixtureProject(page);
	const worktree = realpathSync(E2E_FIXTURE_REPO);
	seedWaitingChat(worktree);
	seedWaitingChat(worktree, NEWER_WAITING_CHAT, "tc-attention-2", 13_000);
	seedDoneChat(worktree);
	seedInterruptedChat(worktree);
	seedFailedChat(worktree);
	await reloadAttention(page);

	const row = defaultWorkspaceRow(page);
	const dot = row.getByTestId("attention-dot");
	await expect(dot).toHaveAttribute("aria-label", "Needs attention, F8 next, Shift+F8 previous");
	await dot.hover();
	await expect(page.getByRole("tooltip")).toContainText("F8 next · Shift+F8 previous");

	const tabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const tab = (name: string) => tabs.filter({ hasText: name });
	await expect(tabs).toHaveCount(0);

	await page.keyboard.press("F8");
	await expect(tab(NEWER_WAITING_CHAT)).toHaveAttribute("data-active", "true");
	await expect(tabs).toHaveCount(1);

	await page.keyboard.press("F8");
	await expect(tab(WAITING_CHAT)).toHaveAttribute("data-active", "true");

	await page.keyboard.press("F8");
	await expect(tab(DONE_CHAT)).toHaveAttribute("data-active", "true");
	await expect(tab(DONE_CHAT).getByTestId("attention-dot")).toHaveCount(0);

	await page.keyboard.press("F8");
	await expect(tab(INTERRUPTED_CHAT)).toHaveAttribute("data-active", "true");
	await page.keyboard.press("F8");
	await expect(tab(FAILED_CHAT)).toHaveAttribute("data-active", "true");
	await expect(tab(FAILED_CHAT).getByRole("tab")).toBeFocused();

	await page.keyboard.press("F8");
	await expect(tab(NEWER_WAITING_CHAT)).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Shift+F8");
	await expect(tab(WAITING_CHAT)).toHaveAttribute("data-active", "true");

	await page.goBack();
	await expect(tab(NEWER_WAITING_CHAT)).toHaveAttribute("data-active", "true");
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
		"Needs attention, F8 next, Shift+F8 previous",
	);
	await shot(page.getByTestId("project-tree"), "attention", "project-collapsed");

	await expand.click();
	await expect(project).not.toHaveAttribute("data-attention", /.+/);
});
