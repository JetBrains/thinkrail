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
