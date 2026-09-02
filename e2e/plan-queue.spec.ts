import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// The real user task queue, no agent: Add task persists through todo.add, hydration re-reads the
// same order, drag reorders exactly the un-started user queue through todo.reorder (server-validated),
// delete rides todo.remove behind the confirm popover, and concurrent sessions never share a queue.

async function openWork(page: Page): Promise<void> {
	await activeTab(page).getByTestId("session-view-work").click();
	await expect(page.getByTestId("plan-pane")).toBeVisible();
}

function activeTab(page: Page) {
	return page.locator('[data-testid="editor-tab"][data-active="true"]');
}

async function addTask(page: Page, title: string): Promise<void> {
	await page.getByTestId("plan-add-task").click();
	const input = page.getByTestId("plan-add-task-input");
	await input.fill(title);
	await input.press("Enter");
	await expect(page.getByTestId("plan-add-task-popover")).toHaveCount(0);
	await expect(page.getByTestId("plan-item").filter({ hasText: title })).toBeVisible();
}

function queueTitles(page: Page) {
	return page.locator('[data-testid="plan-current"] [data-testid="plan-item"]');
}

test("Add task persists, hydration restores the queue, reorder is real, delete confirms", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	// The empty plan shows the Work placeholder; the first task arrives via the chat TODO popover.
	await page.getByTestId("chat-plan-toggle").click();
	const popover = page.getByTestId("chat-plan-popover");
	await popover.getByTestId("todo-add-input").fill("Task A");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(popover.getByTestId("todo-row").filter({ hasText: "Task A" })).toBeVisible();
	await page.keyboard.press("Escape");

	await openWork(page);
	await expect(page.getByTestId("plan-current")).toBeVisible();

	await addTask(page, "Task B");
	await addTask(page, "Task C");
	await expect(queueTitles(page)).toHaveText([/Task A/, /Task B/, /Task C/]);

	// user queue rows are draggable, with the drag handle affordance
	const first = queueTitles(page).first();
	await expect(first).toHaveAttribute("draggable", "true");
	await first.hover();
	await expect(first.getByTestId("step-drag-handle")).toBeVisible();

	// drag Task C above Task A — the order persists server-side
	const cBox = await queueTitles(page).nth(2).boundingBox();
	const aBox = await queueTitles(page).nth(0).boundingBox();
	if (!cBox || !aBox) throw new Error("queue rows are not laid out");
	await page.mouse.move(cBox.x + 60, cBox.y + cBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(aBox.x + 60, aBox.y + 2, { steps: 8 });
	await expect(page.getByTestId("step-insertion-line")).toBeVisible();
	await page.mouse.up();
	await expect(queueTitles(page)).toHaveText([/Task C/, /Task A/, /Task B/]);

	// hydration: a full reload re-reads the persisted order — no client source of truth
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await openWork(page);
	await expect(queueTitles(page)).toHaveText([/Task C/, /Task A/, /Task B/]);

	// delete goes through the confirm popover and persists
	const doomed = queueTitles(page).filter({ hasText: "Task A" });
	await doomed.hover();
	await doomed.getByTestId("step-delete").click();
	await expect(page.getByTestId("confirm-popover")).toBeVisible();
	await page.getByTestId("step-confirm-delete").click();
	await expect(queueTitles(page)).toHaveText([/Task C/, /Task B/]);
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await openWork(page);
	await expect(queueTitles(page)).toHaveText([/Task C/, /Task B/]);
});

test("queues are session-scoped: a second chat in the same workspace sees no queue", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-plan-toggle").click();
	const popover = page.getByTestId("chat-plan-popover");
	await popover.getByTestId("todo-add-input").fill("Only in session one");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(
		popover.getByTestId("todo-row").filter({ hasText: "Only in session one" }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByTestId("new-chat").first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	await activeTab(page).getByTestId("session-view-work").click();
	await expect(page.getByTestId("work-empty")).toBeVisible();

	// closing and reopening the session tab is a view action — domain state unchanged
	await activeTab(page).getByTestId("session-view-chat").click();
	const tabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await tabs.nth(1).hover();
	await tabs.nth(1).getByTestId("editor-tab-close").click();
	await expect(tabs).toHaveCount(1);
	await tabs.first().click();
	await activeTab(page).getByTestId("session-view-work").click();
	await expect(
		page
			.locator('[data-testid="plan-current"] [data-testid="plan-item"]')
			.filter({ hasText: "Only in session one" }),
	).toBeVisible();
});
