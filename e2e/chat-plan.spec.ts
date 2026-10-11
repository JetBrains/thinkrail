import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
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

	await page.getByTestId("tool-rail-plan").click();
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

	await page.getByTestId("tool-rail-plan").click();
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

	// The rail stays visible while we add from it \u2014 both the rail list and the center-tab Plan
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

test("uncommitted work no step claims shows on the plan page as Outside the plan", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const loosePath = join(worktree(), "loose-note.md");
	writeFileSync(loosePath, "work the plan never captured\n");
	try {
		await page.getByTestId("tool-rail-plan").click();
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
