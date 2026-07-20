import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, stageHookProject } from "./fixtures/app";

// Real host, real worktree, real `sh -c` subprocess — no agent needed (`onCreate` is a plain shell
// command declared in `.thinkrail/hooks.json`, not anything pi-driven). Covers the whole loop: an
// unapproved hook holds at `hookAwaitingApproval` (badge on the row), approving composes
// `workspace.hooks.approve` + `workspace.hooks.run` (the retrigger this feature exists for), and the
// result streams back over `workspace.hook` into both the row badge and the Hooks panel's live output.

test("an unapproved onCreate hook holds for approval, then runs and streams output on approve", async ({
	page,
}) => {
	stageHookProject({ onCreate: "echo hello-from-onCreate" });
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();

	await createWorkspaceViaDialog(page);
	const row = page.getByTestId("workspace-item").first();
	const badge = row.getByTestId("workspace-hook-badge");

	// The unapproved command holds the workspace at `hookAwaitingApproval` — a badge on the row, not a
	// blocked workspace: the row itself is fully created and selectable regardless.
	await expect(badge).toHaveAttribute("data-hook-status", "awaitingApproval");

	// Clicking the badge (awaitingApproval) opens the approval modal directly, showing the exact command.
	await badge.click();
	const dialog = page.getByTestId("confirm-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("echo hello-from-onCreate");

	// Approve — composes workspace.hooks.approve + workspace.hooks.run, so this specific workspace's
	// pending onCreate actually gets bootstrapped (not just "approved for next time").
	await page.getByTestId("confirm-approve-hook").click();
	await expect(dialog).toBeHidden();

	// The row badge converges to succeeded via the live `workspace.hook` event stream.
	await expect(badge).toHaveAttribute("data-hook-status", "succeeded", { timeout: 10_000 });

	// The Hooks panel (reached via the row, since the badge is no longer the awaitingApproval fast-path)
	// shows the same state plus the streamed output.
	await row.click();
	await page.getByTestId("tab-hooks").click();
	const hookRow = page.getByTestId("hook-row").filter({ hasText: "onCreate" });
	await expect(hookRow).toHaveAttribute("data-status", "succeeded");
	await expect(hookRow.getByTestId("hook-output")).toContainText("hello-from-onCreate");
});
