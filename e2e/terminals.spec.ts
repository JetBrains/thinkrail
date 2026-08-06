import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openTerminal,
	runInTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";

test("a workspace opens a terminal automatically, rooted in the worktree, with working I/O", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);

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
	await expect(worktreeRows(page)).toHaveCount(2);
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).not.toContainText("TR_WS1_BUFFER");

	// Back to workspace 1 → its terminal and buffer are restored (never unmounted).
	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(visibleTerminalScreen(page)).toContainText("TR_WS1_BUFFER");
});

test("multiple terminals per workspace keep independent buffers and can be closed", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await waitTerminalReady(page); // the auto terminal (terminal 1)
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

// The reported bug: a Russian-layout user saw the terminal corrupt their input. The root cause was the PTY
// inheriting no locale at all — a GUI-launched host (Finder/Dock, launchd, a container) gets none — which
// leaves bash/readline *byte*-oriented, so one backspace deletes half of a two-byte character and the line
// desyncs from what the shell holds. `resolveShellEnv` now installs a UTF-8 `LANG` when the host has none.
//
// Honest scope: this pins the invariant, not the failure. It can only go red on a host that itself has no
// locale, and the e2e host inherits the developer's environment, where `LANG` is usually already set — so
// the decision logic is regression-tested at the unit level instead (`packages/shared/src/shellEnv.test.ts`
// covers every branch of `localeRepair`). What this adds is end-to-end coverage of the composition
// shellEnv → process.env → ptyEnv → PTY, which no unit test spans.
test("the terminal's shell counts characters, not bytes", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const term = visibleTerminalScreen(page);

	// "привет" is 6 characters but 12 bytes, and `wc -m` counts in the current locale — so a byte-oriented
	// shell reports 12 here. That is the same shell that deletes half a character per backspace, which is
	// what the user actually saw.
	// (`tr -d` strips the leading padding BSD `wc` adds, so the marker matches on macOS too.)
	await runInTerminal(page, "echo \"LEN=$(printf %s привет | wc -m | tr -d ' ')\"");
	await expect(term).toContainText("LEN=6");

	// And the locale making it so is genuinely a UTF-8 one, whichever name the platform resolved to.
	await runInTerminal(page, 'echo "CHARMAP=$(locale charmap)"');
	await expect(term).toContainText("CHARMAP=UTF-8");
});

// Regression: `TerminalsPanel` is mounted only inside the shell's `hasActiveWorkspace` branch, so clicking a
// project row — the deliberate "project home" gesture, which clears the active workspace — unmounted every
// terminal of *every* workspace, and each unmount closed its PTY. Anything running in one (a dev server, a
// watch build) was silently killed by a single click, with the tabs reappearing afterwards backed by new,
// empty shells, so nothing looked wrong. Instances now detach their PTY and the next mount re-adopts it.
test("a shell survives a trip to Project Home and back", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);

	// A shell variable is the discriminator: only *this* shell process holds it. A replacement shell echoes an
	// empty value, which is precisely what the bug produced.
	await runInTerminal(page, "TR_SURVIVOR=alive");
	await runInTerminal(page, 'echo "CHECK=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");

	// Project Home tears the whole workspace surface down, terminals included.
	await page.getByTestId("project-item").first().click();
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	// Back into the workspace. The remount is a fresh xterm buffer, so the old output is genuinely gone and
	// the assertion below can only pass on newly painted output from the re-adopted shell.
	await worktreeRows(page).nth(0).getByRole("button").first().click();
	await waitTerminalReady(page);
	await expect(visibleTerminalScreen(page)).not.toContainText("CHECK=alive");

	await runInTerminal(page, 'echo "CHECK=$TR_SURVIVOR"');
	await expect(visibleTerminalScreen(page)).toContainText("CHECK=alive");
});
