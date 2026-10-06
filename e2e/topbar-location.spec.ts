import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	openFixtureProject,
	PHONE_VIEWPORT,
	worktreeRows,
} from "./fixtures/app";

// The topbar location strip is a row of captioned segments (PROJECT · WORKSPACE · BRANCH · from base ·
// REMOTE · PULL REQUEST). Every value is a control: the project pill switches projects, the workspace pill
// carries the workspace actions plus a sibling switcher, the branch pill opens the git card. Review/remote
// facts need a forge, so those chips are pinned by unit tests; this journey covers the rest end to end.

test("the location segments name the active workspace and switch through their menus", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const scope = page.getByTestId("scope-context");
	await expect(scope).toHaveAttribute("data-context", "workspace");
	await expect(page.getByTestId("scope-project-name")).toHaveText("sample-project");
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(page.getByTestId("scope-branch")).toHaveText("workspace-1");
	await expect(page.getByTestId("scope-base")).toHaveText("main");
	await expect(page.getByTestId("scope-remote-segment")).toHaveCount(0);
	await expect(page.getByTestId("scope-review-segment")).toHaveCount(0);
	for (const id of ["scope-project", "scope-workspace", "scope-branch-trigger"]) {
		await expect(page.getByTestId(id)).toHaveCSS("-webkit-app-region", "no-drag");
	}
	await testInfo.attach("location-worktree", {
		body: await page
			.getByTestId("topbar")
			.screenshot({ path: testInfo.outputPath("location-worktree.png") }),
		contentType: "image/png",
	});

	// Workspace menu → switch to a sibling.
	await page.getByTestId("scope-workspace").click();
	const workspaceMenu = page.getByTestId("scope-workspace-menu");
	await expect(workspaceMenu).toBeVisible();
	await testInfo.attach("workspace-menu", {
		body: await page.screenshot({ path: testInfo.outputPath("workspace-menu.png") }),
		contentType: "image/png",
	});
	await workspaceMenu.getByTestId("scope-workspace-option").filter({ hasText: "Default" }).click();
	await expect(page.getByTestId("scope-name")).toHaveText("Default");
	await expect(page.getByTestId("scope-branch")).toHaveText("main");
	await expect(page.getByTestId("scope-base")).toHaveCount(0);
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await testInfo.attach("location-default", {
		body: await page
			.getByTestId("topbar")
			.screenshot({ path: testInfo.outputPath("location-default.png") }),
		contentType: "image/png",
	});

	// …and back, then rename in place.
	await page.getByTestId("scope-workspace").click();
	await workspaceMenu
		.getByTestId("scope-workspace-option")
		.filter({ hasText: "workspace-1" })
		.click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await page.getByTestId("scope-workspace").click();
	await workspaceMenu.getByTestId("scope-workspace-rename").click();
	const nameInput = page.locator('[data-testid="scope-name"][data-editing]');
	await expect(nameInput).toBeFocused();
	await testInfo.attach("location-rename", {
		body: await page
			.getByTestId("topbar")
			.screenshot({ path: testInfo.outputPath("location-rename.png") }),
		contentType: "image/png",
	});
	await nameInput.fill("Image region fix");
	await nameInput.press("Enter");
	await expect(page.getByTestId("scope-name")).toHaveText("Image region fix");
	await expect(worktreeRows(page).first().getByTestId("workspace-name")).toHaveText(
		"Image region fix",
	);
	await expect(page.getByTestId("scope-branch")).toHaveText("workspace-1");

	// Branch card: copy the branch name and retarget the compare base.
	await page.getByTestId("scope-branch-trigger").click();
	const card = page.getByTestId("scope-branch-popover");
	await expect(card).toBeVisible();
	await expect(card).toContainText("workspace-1");
	await expect(card).toContainText("main");
	await testInfo.attach("branch-card", {
		body: await page.screenshot({ path: testInfo.outputPath("branch-card.png") }),
		contentType: "image/png",
	});
	await card.getByTestId("scope-diff-base").click();
	await page.getByTestId("branch-option").filter({ hasText: "workspace-1" }).first().click();
	await expect(card.getByTestId("scope-diff-base")).toContainText("workspace-1");
	await page.keyboard.press("Escape");
	await expect(card).toBeHidden();
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-target-picker")).toContainText("workspace-1");

	// New workspace from the menu opens the shell-owned dialog.
	await page.getByTestId("scope-workspace").click();
	await workspaceMenu.getByTestId("scope-workspace-new").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("new-workspace-dialog")).toBeHidden();

	// Project menu → Project home.
	await page.getByTestId("scope-project").click();
	const projectMenu = page.getByTestId("scope-project-menu");
	await expect(projectMenu).toBeVisible();
	await expect(projectMenu.getByTestId("scope-project-option")).toHaveCount(1);
	await projectMenu.getByTestId("scope-project-home").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(scope).toHaveAttribute("data-context", "project-home");
	await expect(page.getByTestId("scope-name")).toHaveText("Project home");
	await expect(page.getByTestId("scope-branch-segment")).toHaveCount(0);

	// The workspace pill still switches from Project home.
	await page.getByTestId("scope-workspace").click();
	await workspaceMenu
		.getByTestId("scope-workspace-option")
		.filter({ hasText: "Image region fix" })
		.click();
	await expect(scope).toHaveAttribute("data-context", "workspace");
	await expect(page.getByTestId("scope-name")).toHaveText("Image region fix");

	// Narrow windows keep the workspace and drop the project and branch segments.
	await page.setViewportSize(PHONE_VIEWPORT);
	await expect(page.getByTestId("scope-name")).toBeVisible();
	await expect(page.getByTestId("scope-project-segment")).toBeHidden();
	await expect(page.getByTestId("scope-branch-segment")).toBeHidden();
	await testInfo.attach("location-phone", {
		body: await page
			.getByTestId("topbar")
			.screenshot({ path: testInfo.outputPath("location-phone.png") }),
		contentType: "image/png",
	});
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect(page.getByTestId("scope-branch-segment")).toBeVisible();

	// Remove from the menu falls back to the Default workspace.
	await page.getByTestId("scope-workspace").click();
	await workspaceMenu.getByTestId("scope-workspace-remove").click();
	await page.getByTestId("confirm-remove").click();
	await expect(page.getByTestId("scope-name")).toHaveText("Default");
	await expect(worktreeRows(page)).toHaveCount(0);
});
