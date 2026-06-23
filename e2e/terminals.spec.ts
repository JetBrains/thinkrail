import { expect, test } from "@playwright/test";
import { openFixtureProject, openTerminal, runInTerminal, visibleTerminal } from "./fixtures/app";

test("a terminal runs in the active worktree and round-trips I/O", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);

	await openTerminal(page);
	const term = visibleTerminal(page);

	// The PTY's cwd is the worktree (its basename is the workspace branch dir).
	await runInTerminal(page, 'basename "$(pwd)"');
	await expect(term).toContainText("workspace-1");

	// Keystrokes reach the PTY and its output streams back into the buffer.
	await runInTerminal(page, "echo TR_MARKER_IO");
	await expect(term).toContainText("TR_MARKER_IO");
});

test("terminals are workspace-scoped and survive workspace switches", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click(); // workspace 1
	await openTerminal(page);
	await runInTerminal(page, "echo TR_WS1_BUFFER");
	await expect(visibleTerminal(page)).toContainText("TR_WS1_BUFFER");

	// A fresh second workspace has its own (empty) terminal set.
	await page.getByTestId("add-workspace").first().click(); // workspace 2 (now active)
	await expect(page.getByTestId("workspace-item")).toHaveCount(2);
	await expect(page.getByTestId("terminals-empty")).toBeVisible();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);

	// Back to workspace 1 → its terminal and buffer are restored (never unmounted).
	await page.getByTestId("workspace-item").nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminal(page)).toContainText("TR_WS1_BUFFER");
});

test("multiple terminals per workspace keep independent buffers and can be closed", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();

	await openTerminal(page); // terminal 1
	await runInTerminal(page, "echo TR_ONE");
	await expect(visibleTerminal(page)).toContainText("TR_ONE");

	await openTerminal(page); // terminal 2 (now active)
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	await runInTerminal(page, "echo TR_TWO");
	await expect(visibleTerminal(page)).toContainText("TR_TWO");
	await expect(visibleTerminal(page)).not.toContainText("TR_ONE");

	// Switching tabs swaps buffers — each terminal is independent.
	await page.getByTestId("terminal-tab").nth(0).click();
	await expect(visibleTerminal(page)).toContainText("TR_ONE");
	await expect(visibleTerminal(page)).not.toContainText("TR_TWO");

	// Closing a terminal removes its tab.
	await page.getByTestId("terminal-tab-close").nth(1).click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
});
