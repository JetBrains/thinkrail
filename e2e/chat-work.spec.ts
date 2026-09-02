import { realpathSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openChatFromHistory,
	openFixtureProject,
	openWorkspaceChat,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_800_000_000;

const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

async function addPlanItem(page: Page, title: string): Promise<void> {
	await page.getByTestId("chat-plan-toggle").click();
	const popover = page.getByTestId("chat-plan-popover");
	await popover.getByTestId("todo-add-input").fill(title);
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(popover.getByTestId("todo-row").filter({ hasText: title })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("chat-plan-popover")).toHaveCount(0);
}

test("Work stays disabled until the plan has content, never auto-switches, and the header switch is reversible", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	await expect(page.getByTestId("session-view-switcher")).toBeVisible();
	await expect(page.getByTestId("session-view-chat")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("session-view-work")).toBeDisabled();

	await addPlanItem(page, "Ship the feature");

	await expect(page.getByTestId("session-view-work")).toBeEnabled();
	await expect(page.getByTestId("chat-view")).toBeVisible();
	await expect(page.getByTestId("session-view-chat")).toHaveAttribute("data-active", "true");

	await page.getByTestId("session-view-work").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();
	await expect(page.getByTestId("chat-view")).toHaveCount(0);
	await expect(page.getByTestId("session-view-work")).toHaveAttribute("data-active", "true");
	await expect(pane.getByTestId("plan-item").filter({ hasText: "Ship the feature" })).toBeVisible();

	await expect(page.locator('[data-testid="editor-tab"]')).toHaveCount(1);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="plan"]')).toHaveCount(0);

	await page.getByTestId("session-view-chat").click();
	await expect(page.getByTestId("chat-view")).toBeVisible();
	await expect(page.getByTestId("chat-input")).toBeVisible();
});

test("one Work started action anchors the plan-creating turn and switches to Work", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedWorkspaceSession(repoCwd(), {
		name: "work marker chat",
		messages: [
			{ role: "user", text: "build the importer", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Planning the work now.",
				timestamp: BASE_TS + 1_000,
				toolCalls: [{ id: "call-plan", name: "todo_write", arguments: { groups: [] } }],
			},
			{
				role: "toolResult",
				toolCallId: "call-plan",
				text: "Wrote the plan",
				timestamp: BASE_TS + 2_000,
			},
			{
				role: "assistant",
				text: "Adding one more step.",
				timestamp: BASE_TS + 3_000,
				toolCalls: [{ id: "call-add", name: "todo_add", arguments: { title: "extra" } }],
			},
			{ role: "toolResult", toolCallId: "call-add", text: "Added", timestamp: BASE_TS + 4_000 },
		],
	});
	utimesSync(session.path, new Date(BASE_TS + 10_000), new Date(BASE_TS + 10_000));

	try {
		await enterDefaultWorkspace(page);
		await openChatFromHistory(page, "work marker chat");
		await expect(page.getByTestId("chat-view")).toBeVisible();

		await expect(page.getByTestId("session-view-work")).toBeDisabled();
		await expect(page.getByTestId("work-started")).toHaveCount(0);

		await addPlanItem(page, "Import the data");

		await expect(page.getByTestId("work-started")).toHaveCount(1);
		await page.getByTestId("view-work").click();
		const pane = page.getByTestId("plan-pane");
		await expect(pane).toBeVisible();
		await expect(
			pane.getByTestId("plan-item").filter({ hasText: "Import the data" }),
		).toBeVisible();

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(page.getByTestId("chat-view")).toBeVisible();
		await expect(page.getByTestId("session-view-chat")).toHaveAttribute("data-active", "true");
		await expect(page.getByTestId("session-view-work")).toBeEnabled();
		await expect(page.getByTestId("work-started")).toHaveCount(1);
	} finally {
		rmSync(join(repoCwd(), ".thinkrail"), { recursive: true, force: true });
	}
});
