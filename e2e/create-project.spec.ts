import { expect, test } from "@playwright/test";
import { defaultWorkspaceRow, openAppFresh } from "./fixtures/app";

// The agent-led interview + finalize_project step is @agent-tier; this spec covers the
// no-agent domain wiring: clicking the entry point creates a real (draft) server-owned
// project + its Default workspace and lands the user in a chat there.

test("Create project from scratch (Welcome card) creates a draft project in its Default workspace", async ({
	page,
}) => {
	await openAppFresh(page);

	await expect(page.getByTestId("welcome-action")).toContainText("Create project from scratch");
	await page
		.getByTestId("welcome-action")
		.filter({ hasText: "Create project from scratch" })
		.click();

	// A real project now exists in the rail with a provisional name, entered in its Default workspace.
	await expect(page.getByTestId("project-item").filter({ hasText: "Project draft" })).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]').first()).toBeVisible();
});

test("the add-project menu offers both New project from scratch and Open existing project", async ({
	page,
}) => {
	await openAppFresh(page);

	await page.getByTestId("add-project-menu").click();
	await expect(page.getByTestId("menu-create-project")).toBeVisible();
	await expect(page.getByTestId("menu-open-project")).toBeVisible();

	await page.getByTestId("menu-create-project").click();
	await expect(page.getByTestId("project-item").filter({ hasText: "Project draft" })).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
});

test("a draft project offers Delete draft (with confirm) that removes it and returns to the empty state", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-create-project").click();

	const draftRow = page.getByTestId("project-item").filter({ hasText: "Project draft" });
	await expect(draftRow).toBeVisible();

	await draftRow.click({ button: "right" });
	await expect(page.getByTestId("project-actions")).toBeVisible();
	// A draft shows a destructive Delete draft, never the plain Close project.
	await expect(page.getByTestId("project-menu-delete-draft")).toBeVisible();
	await expect(page.getByTestId("project-menu-close")).toHaveCount(0);
	await page.getByTestId("project-menu-delete-draft").click();

	const confirm = page.getByTestId("confirm-delete-draft");
	await expect(confirm).toBeVisible();
	await confirm.click();

	// The draft is gone everywhere and the no-project Welcome (with its cards) is back.
	await expect(page.getByTestId("project-item")).toHaveCount(0);
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("welcome-action")).toContainText("Create project from scratch");
});
