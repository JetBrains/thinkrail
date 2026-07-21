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

test("the plan opens as a rendered markdown doc tab (no file on disk)", async ({ page }) => {
	await openWorkspaceChat(page);

	await page.getByTestId("chat-plan-toggle").click();
	const popover = page.getByTestId("chat-plan-popover");
	await popover.getByTestId("todo-add-input").fill("Draft the outline");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(
		popover.getByTestId("todo-row").filter({ hasText: "Draft the outline" }),
	).toBeVisible();

	// "Open as markdown" → an ephemeral doc tab opens with the plan compiled to markdown.
	await popover.getByTestId("todo-open-markdown").click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="doc"]')).toContainText("TODO");
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();
	await expect(preview.getByRole("heading", { level: 1 })).toContainText("TODO");
	await expect(preview).toContainText("Draft the outline");
});
