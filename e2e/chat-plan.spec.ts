import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat, revealWorkbenchTool } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");

test("the TODO rail opens from the right-side tool rail and takes a user item", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	// The chat-plan popover + its header toggle are gone with the move to a rail-tool. The rail is
	// reached from the right-side tool-rail button (`tool-rail-plan`), same as Files / Specs / Review.
	await expect(page.getByTestId("chat-plan-toggle")).toHaveCount(0);
	await expect(page.getByTestId("chat-plan-popover")).toHaveCount(0);

	await revealWorkbenchTool(page, "plan");
	const rail = page.getByTestId("plan-rail-pane");
	await expect(rail).toBeVisible();

	await rail.getByTestId("todo-add-input").fill("Draft the outline");
	await rail.getByTestId("todo-add-input").press("Enter");
	const row = rail.getByTestId("todo-row").filter({ hasText: "Draft the outline" });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("data-status", "pending");
	await expect(row.getByTestId("todo-origin-user")).toBeVisible();
});

test("the full Plan page opens from the rail's open-plan button and reflects rail-added items", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openWorkspaceChat(page);

	await revealWorkbenchTool(page, "plan");
	const rail = page.getByTestId("plan-rail-pane");
	await rail.getByTestId("todo-add-input").fill("Draft the outline");
	await rail.getByTestId("todo-add-input").press("Enter");
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Draft the outline" })).toBeVisible();

	await rail.getByTestId("todo-open-plan").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="plan"]')).toContainText("Plan");
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();
	await expect(pane.getByRole("heading", { level: 1 })).toContainText("Plan");
	await expect(
		pane.getByTestId("plan-item").filter({ hasText: "Draft the outline" }),
	).toBeVisible();
	await expect(pane.getByTestId("plan-progress")).toContainText("0/1");

	// The rail stays visible while we add from it — both the rail list and the center-tab Plan
	// update because they share the same TodoStore.
	await rail.getByTestId("todo-add-input").fill("Second thought");
	await rail.getByTestId("todo-add-input").press("Enter");
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Second thought" })).toBeVisible();
	await expect(pane.getByTestId("plan-item").filter({ hasText: "Second thought" })).toBeVisible();
	await expect(pane.getByTestId("plan-progress")).toContainText("0/2");

	await pane.getByTestId("plan-menu").click();
	await page.getByTestId("plan-copy-markdown").click();
	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboard).toContain("# TODO");
	expect(clipboard).toContain("Draft the outline");
});

test("a task added from the Plan page shows up in the rail without an agent tick", async ({
	page,
}) => {
	// Regression companion for the rail→page direction above: the two surfaces each own a React
	// state in `useChatTodos`, so a write on one must signal the other via the module-local refetch
	// bus. This locks the PAGE→RAIL direction so a future refactor can't quietly regress it.
	await openWorkspaceChat(page);
	await revealWorkbenchTool(page, "plan");
	const rail = page.getByTestId("plan-rail-pane");
	await expect(rail).toBeVisible();
	await rail.getByTestId("todo-add-input").fill("Rail-first item");
	await rail.getByTestId("todo-add-input").press("Enter");
	await rail.getByTestId("todo-open-plan").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();
	await expect(pane.getByTestId("plan-item").filter({ hasText: "Rail-first item" })).toBeVisible();

	// Add from the center PAGE this time, and expect the RAIL to pick it up.
	await pane.getByTestId("plan-add-task").click();
	await pane.getByTestId("plan-add-input").fill("Page-first item");
	await pane.getByTestId("plan-add-input").press("Enter");
	await expect(pane.getByTestId("plan-item").filter({ hasText: "Page-first item" })).toBeVisible();
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Page-first item" })).toBeVisible();
	await expect(pane.getByTestId("plan-progress")).toContainText("0/2");
});

test("an empty chat shows the empty-rail copy and no todo rows", async ({ page }) => {
	// Lock the explicit idle state so a refactor can't quietly render a stale skeleton or leave a
	// ghost `todo-row` from a cached plan. The rail copy comes from `PlanRailPane`.
	await openWorkspaceChat(page);
	await revealWorkbenchTool(page, "plan");
	const rail = page.getByTestId("plan-rail-pane");
	await expect(rail).toBeVisible();
	await expect(rail).toContainText("No TODOs yet");
	await expect(rail.getByTestId("todo-row")).toHaveCount(0);
	await expect(rail.getByTestId("todo-group")).toHaveCount(0);
});

test("two chats keep their own TODO lists \u2014 a rail write in chat A never bleeds into chat B", async ({
	page,
}) => {
	// Lock the refetch-bus key isolation end-to-end: `useChatTodos` is keyed on
	// `tupleKey("chat-todos", workspaceId, sessionId)`, so a signal for chat A must not nudge chat
	// B's hook. Without the bus's per-key bucketing a shared Zustand slice would almost certainly
	// cross-pollinate, so a focused multi-chat scenario is the right place to guard that.
	await openWorkspaceChat(page);
	await revealWorkbenchTool(page, "plan");
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTabs).toHaveCount(1);

	const rail = page.getByTestId("plan-rail-pane");
	await rail.getByTestId("todo-add-input").fill("Chat A item");
	await rail.getByTestId("todo-add-input").press("Enter");
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Chat A item" })).toBeVisible();

	// Open a second chat in the same workspace and switch to it: the rail is a singleton tied to
	// the active chat, so it should retarget and show an empty list — not Chat A's leftover row.
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(2);
	await expect(chatTabs.last()).toHaveAttribute("data-active", "true");
	await expect(rail).toBeVisible();
	await expect(rail.getByTestId("todo-row")).toHaveCount(0);
	await expect(rail).toContainText("No TODOs yet");

	// Add a DIFFERENT item in chat B. Both the add and any eventual bus-signal are keyed on chat
	// B's identity, so chat A's data must remain untouched.
	await rail.getByTestId("todo-add-input").fill("Chat B item");
	await rail.getByTestId("todo-add-input").press("Enter");
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Chat B item" })).toBeVisible();
	await expect(rail.getByTestId("todo-row")).toHaveCount(1);

	// Switch back to chat A: rail refocuses on its original list, chat B's write did not bleed in.
	await chatTabs.first().getByRole("tab").click();
	await expect(chatTabs.first()).toHaveAttribute("data-active", "true");
	await expect(rail.getByTestId("todo-row")).toHaveCount(1);
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Chat A item" })).toBeVisible();
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Chat B item" })).toHaveCount(0);

	// And once more to B, to make sure retarget is symmetric (not just a one-shot initial load).
	await chatTabs.last().getByRole("tab").click();
	await expect(chatTabs.last()).toHaveAttribute("data-active", "true");
	await expect(rail.getByTestId("todo-row")).toHaveCount(1);
	await expect(rail.getByTestId("todo-row").filter({ hasText: "Chat B item" })).toBeVisible();
});

test("uncommitted work no step claims shows on the plan page as Outside the plan", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const loosePath = join(worktree(), "loose-note.md");
	writeFileSync(loosePath, "work the plan never captured\n");
	try {
		await revealWorkbenchTool(page, "plan");
		const rail = page.getByTestId("plan-rail-pane");
		await rail.getByTestId("todo-add-input").fill("Planned step");
		await rail.getByTestId("todo-add-input").press("Enter");
		await expect(rail.getByTestId("todo-row").filter({ hasText: "Planned step" })).toBeVisible();
		await rail.getByTestId("todo-open-plan").click();

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
