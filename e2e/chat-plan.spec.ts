import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// The chat's TODO plan surfaced inline: a strip in the chat header opens a popup over the chat with the
// plan (which lives only in the chat — there is no right-panel Todo tab). No-agent — it starts a chat (no
// prompt) and drives the user's editing path; the agent maintaining the plan is the @agent spec
// (todos-plan.live.spec.ts).
test("the chat plan opens as a popup from the header strip and takes a user item", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	// The plan strip lives in the chat header; the popup is closed by default.
	const toggle = page.getByTestId("chat-plan-toggle");
	await expect(toggle).toBeVisible();
	await expect(page.getByTestId("chat-plan-popover")).toHaveCount(0);

	// Open it and add an item → it shows as a pending, user-owned row.
	await toggle.click();
	const popover = page.getByTestId("chat-plan-popover");
	await expect(popover).toBeVisible();
	await popover.getByTestId("todo-add-input").fill("Draft the outline");
	await popover.getByTestId("todo-add-input").press("Enter");
	const row = popover.getByTestId("todo-row").filter({ hasText: "Draft the outline" });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("data-status", "pending");
	await expect(row.getByTestId("todo-origin-user")).toBeVisible();

	// Close on outside-click (Escape) → the strip reflects the count at a glance.
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

	// "Open the plan page" → a live `plan` center tab (not a static markdown snapshot).
	await popover.getByTestId("todo-open-plan").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="plan"]')).toContainText("Plan");
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();
	await expect(pane.getByRole("heading", { level: 1 })).toContainText("Plan");
	await expect(
		pane.getByTestId("plan-item").filter({ hasText: "Draft the outline" }),
	).toBeVisible();
	await expect(pane.getByTestId("plan-progress")).toContainText("0/1");

	// LIVE, not a snapshot: edit the plan back in the chat tab, return — the page shows the new item
	// (it re-reads the plan, never a compiled-at-open snapshot).
	await page.locator('[data-testid="editor-tab"][data-kind="chat"]').click();
	await page.getByTestId("chat-plan-toggle").click();
	await popover.getByTestId("todo-add-input").fill("Second thought");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(popover.getByTestId("todo-row").filter({ hasText: "Second thought" })).toBeVisible();
	await page.locator('[data-testid="editor-tab"][data-kind="plan"]').click();
	await expect(pane.getByTestId("plan-item").filter({ hasText: "Second thought" })).toBeVisible();
	await expect(pane.getByTestId("plan-progress")).toContainText("0/2");

	// Export: copy-as-markdown lands the compiled plan in the clipboard.
	await pane.getByTestId("plan-copy-markdown").click();
	const clipboard = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboard).toContain("# TODO");
	expect(clipboard).toContain("Draft the outline");
});
