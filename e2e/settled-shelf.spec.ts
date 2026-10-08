import { expect, test } from "@playwright/test";
import { WORKSPACE_SETTLE_PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

// The Settled shelf: quiet workspaces leave the live list for a collapsed group under the project. Idle
// and merged-PR settling need time or a forge and are pinned by unit tests; this journey covers the
// manual overrides, the topbar mirror, and force-reveal end to end.

test("a workspace settles by hand and comes back with Keep active", async ({ page }, testInfo) => {
	await openFixtureProject(page);
	const first = await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);

	const shelf = page.getByTestId("settled-shelf");
	await expect(page.getByTestId("workspace-sort")).toBeVisible();
	await expect(shelf).toHaveAttribute("data-count", "0");
	await expect(worktreeRows(page)).toHaveCount(2);

	// Hover ✓ on the quiet sibling parks it; the collapsed shelf hides the row and counts it.
	const firstRow = worktreeRows(page).filter({ hasText: first.name });
	await firstRow.hover();
	await firstRow.getByTestId("workspace-settle").click();
	await expect(shelf).toHaveAttribute("data-count", "1");
	await expect(worktreeRows(page)).toHaveCount(1);

	await page.getByTestId("settled-shelf-toggle").click();
	const settledRow = page.locator('[data-testid="workspace-item"][data-settled="override"]');
	await expect(settledRow).toHaveCount(1);
	await expect(settledRow.getByTestId("workspace-settled-reason")).toHaveText("by you");
	await testInfo.attach("shelf-expanded", {
		body: await page
			.getByTestId("project-tree")
			.screenshot({ path: testInfo.outputPath("shelf.png") }),
		contentType: "image/png",
	});

	// The topbar switcher mirrors the partition: live siblings, then a Settled submenu.
	await page.getByTestId("scope-workspace").click();
	await expect(page.getByTestId("scope-workspace-settled")).toHaveCount(0);
	await page.getByTestId("scope-workspace-settled-group").hover();
	await expect(page.getByTestId("scope-workspace-settled-option")).toHaveCount(1);
	await page.keyboard.press("Escape");

	// Opening a settled workspace keeps it settled: force-revealed in the shelf, announced in the caption.
	await settledRow.getByRole("button", { name: first.name, exact: true }).click();
	await expect(page.getByTestId("scope-name")).toHaveText(first.name);
	await expect(page.getByTestId("scope-workspace-settled")).toBeVisible();
	await expect(settledRow).toHaveAttribute("data-active", "true");
	await expect(shelf).toHaveAttribute("data-count", "1");

	// Keep active from the topbar menu returns it to the live list.
	await page.getByTestId("scope-workspace").click();
	await page.getByTestId("scope-workspace-keep-active").click();
	await expect(shelf).toHaveAttribute("data-count", "0");
	await expect(page.getByTestId("scope-workspace-settled")).toHaveCount(0);
	await expect(worktreeRows(page).filter({ hasText: first.name })).toHaveAttribute(
		"data-active",
		"true",
	);
});

test("a pre-v78 host keeps the legacy workspace list without shelf affordances", async ({
	page,
}) => {
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		server.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				channel?: string;
				data: { protocolVersion: number };
			};
			if (frame.channel === WS_CHANNELS.serverWelcome) {
				frame.data.protocolVersion = WORKSPACE_SETTLE_PROTOCOL_VERSION - 1;
				socket.send(JSON.stringify(frame));
			} else socket.send(message);
		});
	});
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);

	const rows = worktreeRows(page);
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).getByTestId("workspace-name")).toHaveText("workspace-1");
	await expect(rows.nth(1).getByTestId("workspace-name")).toHaveText("workspace-2");
	await expect(page.getByTestId("workspace-sort")).toHaveCount(0);
	await expect(page.getByTestId("settled-shelf")).toHaveCount(0);
	await rows.nth(0).hover();
	await expect(rows.nth(0).getByTestId("workspace-settle")).toHaveCount(0);

	await page.getByTestId("scope-workspace").click();
	const options = page.getByTestId("scope-workspace-option");
	await expect(options).toHaveCount(2);
	await expect(options.nth(0)).toContainText("Default");
	await expect(options.nth(1)).toContainText("workspace-1");
	await expect(page.getByTestId("scope-workspace-settled-group")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-nav-workspaces")).toHaveCount(0);
});

test("the settle window is a host setting that survives a reload", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-workspaces").click();
	await expect(page.getByTestId("settle-idle-7")).toHaveAttribute("data-active", "true");
	await page.getByTestId("settle-idle-14").click();
	await expect(page.getByTestId("settle-idle-14")).toHaveAttribute("data-active", "true");
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-workspaces").click();
	await expect(page.getByTestId("settle-idle-14")).toHaveAttribute("data-active", "true");
});
