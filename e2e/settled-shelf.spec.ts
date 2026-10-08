import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	type Workspace,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const DAY_MS = 24 * 60 * 60_000;
const PAST_NOTICE_QUIET_MS = 3_000;

function ageWorkspace(id: string, days: number): void {
	const file = join(E2E_DATA_DIR, "workspaces.json");
	const rows = JSON.parse(readFileSync(file, "utf8")) as Workspace[];
	const row = rows.find((candidate) => candidate.id === id);
	if (!row) throw new Error(`workspace ${id} is not persisted`);
	row.lastActiveAt = Date.now() - days * DAY_MS;
	writeFileSync(file, JSON.stringify(rows));
}

// The Settled shelf: quiet workspaces leave the live list for a collapsed group under the project.
// Merged-PR settling needs a forge and is pinned by unit tests; idle settling is staged by ageing a
// persisted record. These journeys cover the manual overrides, the topbar mirror, force-reveal, and the
// one-time first-move notice end to end.

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

test("the shelf's first automatic move is announced once, and Show opens it", async ({ page }) => {
	await openFixtureProject(page);
	const quiet = await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);
	ageWorkspace(quiet.id, 30);
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const shelf = page.getByTestId("settled-shelf");
	await expect(shelf).toHaveAttribute("data-count", "1");
	await expect(shelf).toHaveAttribute("data-expanded", "false");
	const notice = page
		.getByTestId("toast")
		.filter({ hasText: "Moved 1 quiet workspace to Settled" });
	await expect(notice).toBeVisible();
	await notice.getByTestId("toast-action").click();
	await expect(shelf).toHaveAttribute("data-expanded", "true");
	const idleRow = page.locator('[data-testid="workspace-item"][data-settled="idle"]');
	await expect(idleRow).toHaveCount(1);
	await expect(idleRow.getByTestId("workspace-settled-reason")).toHaveText("idle 4w");

	await page.reload();
	await expect(shelf).toHaveAttribute("data-count", "1");
	await page.waitForTimeout(PAST_NOTICE_QUIET_MS);
	await expect(page.getByTestId("toast").filter({ hasText: "quiet workspace" })).toHaveCount(0);
	await expect(shelf).toHaveAttribute("data-expanded", "false");
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
