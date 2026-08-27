import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");

test("the chat plan opens as a popup from the header strip and takes a user item", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	const toggle = page.getByTestId("chat-plan-toggle");
	await expect(toggle).toBeVisible();
	await expect(page.getByTestId("chat-plan-popover")).toHaveCount(0);

	await toggle.click();
	const popover = page.getByTestId("chat-plan-popover");
	await expect(popover).toBeVisible();
	await popover.getByTestId("todo-add-input").fill("Draft the outline");
	await popover.getByTestId("todo-add-input").press("Enter");
	const row = popover.getByTestId("todo-row").filter({ hasText: "Draft the outline" });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("data-status", "pending");
	await expect(row.getByTestId("todo-origin-user")).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.getByTestId("chat-plan-popover")).toHaveCount(0);
	await expect(toggle).toContainText("0/1");
});

test("the plan opens as a live plan page tab (markdown is its export)", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openWorkspaceChat(page);

	await page.getByTestId("chat-plan-toggle").click();
	const popover = page.getByTestId("chat-plan-popover");
	await popover.getByTestId("todo-add-input").fill("Draft the outline");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(
		popover.getByTestId("todo-row").filter({ hasText: "Draft the outline" }),
	).toBeVisible();

	await popover.getByTestId("todo-open-plan").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="plan"]')).toContainText("Plan");
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();
	await expect(pane.getByRole("heading", { level: 1 })).toContainText("Plan");
	await expect(
		pane.getByTestId("plan-item").filter({ hasText: "Draft the outline" }),
	).toBeVisible();
	await expect(pane.getByTestId("plan-progress")).toContainText("0/1");

	await page.locator('[data-testid="editor-tab"][data-kind="chat"]').click();
	await page.getByTestId("chat-plan-toggle").click();
	await popover.getByTestId("todo-add-input").fill("Second thought");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(popover.getByTestId("todo-row").filter({ hasText: "Second thought" })).toBeVisible();
	await page.locator('[data-testid="editor-tab"][data-kind="plan"]').click();
	await expect(pane.getByTestId("plan-item").filter({ hasText: "Second thought" })).toBeVisible();
	await expect(pane.getByTestId("plan-progress")).toContainText("0/2");

	await pane.getByTestId("plan-menu").click();
	await page.getByTestId("plan-copy-markdown").click();
	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboard).toContain("# TODO");
	expect(clipboard).toContain("Draft the outline");
});

test("uncommitted work no step claims shows on the plan page as Outside the plan", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const loosePath = join(worktree(), "loose-note.md");
	writeFileSync(loosePath, "work the plan never captured\n");
	try {
		await page.getByTestId("chat-plan-toggle").click();
		const popover = page.getByTestId("chat-plan-popover");
		await popover.getByTestId("todo-add-input").fill("Planned step");
		await popover.getByTestId("todo-add-input").press("Enter");
		await expect(popover.getByTestId("todo-row").filter({ hasText: "Planned step" })).toBeVisible();
		await popover.getByTestId("todo-open-plan").click();

		const pane = page.getByTestId("plan-pane");
		await expect(pane).toBeVisible();
		const section = pane.getByTestId("plan-unattributed");
		await expect(section).toBeVisible();
		await expect(section).toContainText("Outside the plan");
		await expect(section).toContainText("loose-note.md");
	} finally {
		rmSync(loosePath, { force: true });
	}
});
