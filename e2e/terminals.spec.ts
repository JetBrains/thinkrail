import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";

test("a workspace opens a terminal automatically, rooted in the worktree, with working I/O", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);

	// No click needed — landing on the workspace opens a terminal on its own.
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	// The PTY's cwd is the worktree (its basename is the workspace branch dir).
	await runInTerminal(page, 'basename "$(pwd)"');
	await expect(term).toContainText("workspace-1");

	// Keystrokes reach the PTY and its output streams back into the buffer.
	await runInTerminal(page, "echo TR_MARKER_IO");
	await expect(term).toContainText("TR_MARKER_IO");
});

test("terminals are workspace-scoped and survive workspace switches", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page); // workspace 1 (auto terminal)
	await waitTerminalReady(page);
	await runInTerminal(page, "echo TR_WS1_BUFFER");
	await expect(visibleTerminalScreen(page)).toContainText("TR_WS1_BUFFER");

	// A fresh second workspace gets its own auto terminal — not workspace 1's.
	await createWorkspaceViaDialog(page); // workspace 2 (now active)
	await expect(page.getByTestId("workspace-item")).toHaveCount(2);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_WS1_BUFFER");

	// Back to workspace 1 → its terminal and buffer are restored (never unmounted).
	await page.getByTestId("workspace-item").nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).toContainText("TR_WS1_BUFFER");
});

test("multiple terminals per workspace keep independent buffers and can be closed", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await waitTerminalReady(page); // the auto terminal (terminal 1)
	// The sole tab can't be closed (never down to zero) — no close control until there are 2+ tabs.
	await expect(page.getByTestId("terminal-tab-close")).toHaveCount(0);
	await runInTerminal(page, "echo TR_ONE");
	await expect(visibleTerminalScreen(page)).toContainText("TR_ONE");

	await openTerminal(page); // terminal 2 (now active)
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);
	await runInTerminal(page, "echo TR_TWO");
	await expect(visibleTerminalScreen(page)).toContainText("TR_TWO");
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_ONE");

	// Switching tabs swaps buffers — each terminal is independent.
	await page.getByTestId("terminal-tab").nth(0).click();
	await expect(visibleTerminalScreen(page)).toContainText("TR_ONE");
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_TWO");

	// Closing a terminal removes its tab.
	await page.getByTestId("terminal-tab-close").nth(1).click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
});

test("terminals get stable numbers; closing detaches to the background dropdown; reattach restores", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page); // Terminal 1 (auto)
	const tabs = page.getByTestId("terminal-tab");
	// Tab labels are the full "Terminal N" name; numbering is stable per terminal.
	await expect(tabs).toHaveText(["Terminal 1"]);
	// The background/history control is disabled while nothing is backgrounded.
	await expect(page.getByTestId("terminal-bg")).toBeDisabled();

	await openTerminal(page); // Terminal 2
	await openTerminal(page); // Terminal 3
	await expect(tabs).toHaveText(["Terminal 1", "Terminal 2", "Terminal 3"]);

	// Close Terminal 2 → the survivors keep their numbers (1 and 3, never renumbered to 1 and 2).
	await page.getByTestId("terminal-tab-close").nth(1).click();
	await expect(tabs).toHaveText(["Terminal 1", "Terminal 3"]);

	// Terminal 2 is detached (process still running) — the separate background control lists it, enabled now.
	await expect(page.getByTestId("terminal-bg")).toBeEnabled();
	await page.getByTestId("terminal-bg").click();
	await expect(page.getByText("Running in background")).toBeVisible();
	await expect(page.getByTestId("terminal-bg-item")).toHaveText(["Terminal 2"]);

	// Reattach → Terminal 2 comes back as a tab with its original number.
	await page.getByTestId("terminal-bg-item").click();
	await expect(tabs).toHaveText(["Terminal 1", "Terminal 3", "Terminal 2"]);

	// Background list is empty again → the next number is 4 (2 was never reused).
	await openTerminal(page);
	await expect(tabs).toHaveText(["Terminal 1", "Terminal 3", "Terminal 2", "Terminal 4"]);
});

test("the terminal panel collapses downward from the tab bar and re-expands", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-panel")).toBeVisible();

	// The far-left chevron collapses the terminal → panel hidden, a thin re-expand bar takes its place.
	await page.getByTestId("toggle-terminal-panel").click();
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
	await expect(page.getByTestId("terminal-collapsed")).toBeVisible();

	// Re-expanding restores the panel.
	await page.getByTestId("toggle-terminal-panel").click();
	await expect(page.getByTestId("terminal-panel")).toBeVisible();
	await expect(page.getByTestId("terminal-collapsed")).toHaveCount(0);
});
