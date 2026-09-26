import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	openFixtureProject,
	openTerminal,
	worktreeRows,
} from "./fixtures/app";

test("editor tabs are scoped to the active workspace", async ({ page }) => {
	await openFixtureProject(page);
	const tabs = page.getByTestId("editor-tab");
	const workspaces = worktreeRows(page);

	await createWorkspaceViaDialog(page);
	await expect(workspaces).toHaveCount(1);
	await expect(tabs).toHaveCount(1);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(tabs).toHaveCount(2);

	await createWorkspaceViaDialog(page);
	await expect(workspaces).toHaveCount(2);
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");
	await expect(tabs).toHaveCount(1);
	await expect(tabs.filter({ hasText: "README.md" })).toHaveCount(0);
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-2");
	await expect(page.getByTestId("scope-branch")).toHaveText("workspace-2");

	await workspaces.nth(0).getByRole("button").first().click();
	await expect(workspaces.nth(0)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(page.getByTestId("scope-branch")).toHaveText("workspace-1");
	await expect(tabs).toHaveCount(2);
	await expect(tabs.filter({ hasText: "README.md" })).toBeVisible();
});

test("the selected side tool follows workspace switches", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);
	const workspaces = worktreeRows(page);
	await expect(workspaces).toHaveCount(2);
	await workspaces.nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");

	const groupInfo = await page.getByTestId("tab-specs").evaluate((tab) => {
		const group = tab.closest<HTMLElement>("[data-side][data-group-id]");
		return { side: group?.dataset.side, groupId: group?.dataset.groupId };
	});
	if (!groupInfo.side || !groupInfo.groupId) throw new Error("missing Specs side group");
	const group = page.locator(
		`[data-side="${groupInfo.side}"][data-group-id="${groupInfo.groupId}"]`,
	);

	await page.getByTestId("tab-projects").click({ button: "right" });
	await page
		.getByRole("menuitem", {
			name: `Move to ${groupInfo.side} group ${groupInfo.groupId.slice(-4)}`,
			exact: true,
		})
		.click();
	await group.getByTestId("tab-projects").click();
	await expect(group.getByTestId("tab-projects").getByRole("tab")).toHaveAttribute(
		"aria-selected",
		"true",
	);

	await workspaces.nth(1).getByRole("button").first().click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-2");
	await expect(group.getByTestId("tab-projects").getByRole("tab")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(group.getByTestId("tab-projects").getByRole("tab")).toHaveAttribute(
		"aria-selected",
		"true",
	);

	const review = page.getByTestId("tab-review").getByRole("tab");
	await page.getByTestId("tab-review").click();
	await expect(review).toHaveAttribute("aria-selected", "true");
	await workspaces.nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(review).toHaveAttribute("aria-selected", "true");
	await expect(group.getByTestId("tab-projects").getByRole("tab")).toHaveAttribute(
		"aria-selected",
		"true",
	);
});

test("switching workspaces re-targets the mounted workbench instead of remounting it", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspaces = worktreeRows(page);

	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await openTerminal(page);
	const terminalTabs = page.getByTestId("terminal-tab");
	const terminalCount = await terminalTabs.count();

	await createWorkspaceViaDialog(page);
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");

	await page.evaluate(() => {
		const chrome = ["workspace-workbench", "center-tabs", "left-nav"] as const;
		const marked = chrome.map((id) => document.querySelector(`[data-testid="${id}"]`));
		for (const node of marked) node?.setAttribute("data-switch-probe", "before");
		let fadeIns = 0;
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (!(node instanceof Element)) continue;
					if (node.matches('[class*="animate-fade-in"]')) fadeIns += 1;
					fadeIns += node.querySelectorAll('[class*="animate-fade-in"]').length;
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		(window as unknown as { __switchProbe: () => number }).__switchProbe = () => fadeIns;
	});

	await workspaces.nth(0).getByRole("button").first().click();
	await expect(workspaces.nth(0)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();
	await expect(terminalTabs).toHaveCount(terminalCount);

	for (const id of ["workspace-workbench", "center-tabs", "left-nav"]) {
		await expect(page.getByTestId(id)).toHaveAttribute("data-switch-probe", "before");
	}
	expect(
		await page.evaluate(() =>
			(window as unknown as { __switchProbe: () => number }).__switchProbe(),
		),
	).toBe(0);

	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	for (const id of ["workspace-workbench", "center-tabs", "left-nav"]) {
		await expect(page.getByTestId(id)).toHaveAttribute("data-switch-probe", "before");
	}
	expect(
		await page.evaluate(() =>
			(window as unknown as { __switchProbe: () => number }).__switchProbe(),
		),
	).toBe(0);
});

test("a same-id terminal body remounts instead of carrying across workspaces", async ({ page }) => {
	await openFixtureProject(page);
	const workspaces = worktreeRows(page);
	await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-2");
	const terminal = page.locator(
		'[data-testid="terminal-instance"][data-tab-key="thinkrail-initial"]',
	);
	await expect(terminal).toHaveAttribute("data-ready", "true");
	await terminal.evaluate((node) => node.setAttribute("data-switch-probe", "workspace-2"));

	await workspaces.nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(terminal).toHaveAttribute("data-ready", "true");
	await expect(terminal).not.toHaveAttribute("data-switch-probe", "workspace-2");
});
