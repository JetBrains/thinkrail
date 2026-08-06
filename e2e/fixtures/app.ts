import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import {
	E2E_DATA_DIR,
	E2E_FIXTURE_REPO,
	E2E_PI_AGENT_DIR,
	E2E_PI_MODELS_SEED,
	E2E_PICK_DIR_POINTER,
	E2E_PLAIN_DIR,
} from "./paths";
import { fixtureRepoHealthy, seedFixtureRepo } from "./repo";

/**
 * Reset to a pristine slate: clear app state + any worktrees + pi's persisted sessions, and restore the
 * fixture repo to just `main`. The host reads these files per-request, so tests are isolated despite
 * sharing one host. (pi keys sessions by worktree cwd, and worktree paths repeat across tests since branches
 * are reset — so stale sessions must be cleared or they'd resurface in a later test's reused worktree.)
 *
 * Runs concurrently with the host: a previous @agent spec's settled turn can leave a best-effort
 * auto-rename in flight (a `git branch -m` + a `workspaces.json` save, up to ~12s after the turn). So
 * branch cleanup tolerates per-branch failures and sweeps twice, and `workspaces.json` is deleted last —
 * the host aborts a rename whose record is already gone instead of resurrecting the file.
 */
function resetState(): void {
	rmSync(join(E2E_DATA_DIR, "projects.json"), { force: true });
	rmSync(join(E2E_DATA_DIR, "worktrees"), { recursive: true, force: true });
	rmSync(join(E2E_PI_AGENT_DIR, "sessions"), { recursive: true, force: true });

	// Restore the seeded models.json: the JetBrains AI spec's proxy connect/disconnect rewrites this shared
	// file (stripping the anthropic/openai auth the @agent suite resolves its pinned model through) and leaves
	// the host disconnected. Re-seed it (or clear a test-written one when the dev authed via auth.json only)
	// and drop the `.bak` the wire writes; the next page load's provider.status re-reads it and refreshes the
	// registry, so a later @agent test isn't left with an empty model list.
	const modelsPath = join(E2E_PI_AGENT_DIR, "models.json");
	if (existsSync(E2E_PI_MODELS_SEED)) copyFileSync(E2E_PI_MODELS_SEED, modelsPath);
	else rmSync(modelsPath, { force: true });
	rmSync(`${modelsPath}.bak`, { force: true });

	// Self-heal the shared fixture repo before pruning it. An @agent spec drives a real agent with `bash` in
	// a worktree of this repo, so a stray destructive command can remove it out from under every later test
	// (a single flaky run would otherwise cascade into the whole suite). Re-seed it when it's gone/damaged so
	// the blast radius stays that one spec.
	if (!fixtureRepoHealthy()) seedFixtureRepo();

	// A test can leave the shared repo on another branch (a terminal `git switch` — see
	// default-workspace.spec.ts). Restore `main` first: a checked-out branch can't be deleted by the sweep
	// below, so every later test would inherit both the branch and any dirt on it. Guarded by the branch
	// check — an unconditional `checkout -f` would also resurrect files a test deliberately deleted from
	// the fixture *on main* (welcome.spec.ts strips the seed specs, then re-opens the project).
	try {
		const head = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "symbolic-ref", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim();
		if (head !== "main") {
			execFileSync("git", ["-C", E2E_FIXTURE_REPO, "checkout", "-f", "main"], { stdio: "ignore" });
		}
	} catch {
		// Unreadable HEAD (detached / mid-operation) — the branch sweep below is the backstop.
	}

	execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "prune"]);
	for (let sweep = 0; sweep < 2; sweep += 1) {
		const branches = execFileSync(
			"git",
			["-C", E2E_FIXTURE_REPO, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
			{ encoding: "utf8" },
		)
			.split("\n")
			.map((b) => b.trim())
			.filter((b) => b && b !== "main");
		if (branches.length === 0) break;
		for (const branch of branches) {
			try {
				execFileSync("git", ["-C", E2E_FIXTURE_REPO, "branch", "-D", branch], { stdio: "ignore" });
			} catch {
				// Renamed out from under us mid-sweep — the next sweep sees its new name.
			}
		}
	}

	rmSync(join(E2E_DATA_DIR, "workspaces.json"), { force: true });

	// Restore the stubbed picker to the git fixture, undoing any test that pointed it elsewhere.
	writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
}

/**
 * Reset state, (re)create a plain **non-git** folder with a file in it, and point the stubbed picker at
 * it — so "Open project" exercises the "initialise a repo?" flow. Returns the folder path.
 */
export function stagePlainFolder(): string {
	resetState();
	rmSync(E2E_PLAIN_DIR, { recursive: true, force: true });
	mkdirSync(E2E_PLAIN_DIR, { recursive: true });
	writeFileSync(join(E2E_PLAIN_DIR, "notes.txt"), "hello from a plain folder\n");
	writeFileSync(E2E_PICK_DIR_POINTER, E2E_PLAIN_DIR);
	return E2E_PLAIN_DIR;
}

function loadPersistedWorkspaces(): Workspace[] {
	try {
		return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
	} catch {
		return [];
	}
}

/**
 * Open the New-Workspace dialog from the first project's "+" and create a *bare* workspace (no prompt, so
 * no agent session). The dialog replaced the old one-click create; this is the headless equivalent for
 * the no-agent suite. Resilient to a click that doesn't register under load (re-opens the dialog).
 */
export async function createWorkspaceViaDialog(page: Page): Promise<Workspace> {
	const before = new Set(loadPersistedWorkspaces().map((w) => w.id));
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(async () => {
		if (!(await dialog.isVisible())) await page.getByTestId("add-workspace").first().click();
		await expect(dialog).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 30_000 });
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	// Submitting the dialog always lands in a fresh chat (empty prompt → ready composer). Wait for the
	// auto-opened tab before returning so every caller sees a settled center — the async session.create
	// must not activate a chat tab mid-assertion later in a spec.
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]').first()).toBeVisible();
	// Never the Default: the ensure can materialize its record mid-operation, and callers expect the
	// created *worktree*, not the project folder.
	const created = loadPersistedWorkspaces().find((w) => !before.has(w.id) && w.kind !== "default");
	if (!created) throw new Error("Workspace was not persisted after creation");
	return created;
}

/** Reset to a clean slate (no projects/workspaces) and load the app — leaving the Welcome screen shown. */
export async function openAppFresh(page: Page): Promise<void> {
	resetState();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

/**
 * Reset state, then open the fixture repo as a project via the (stubbed) picker; auto-selects + expands
 * — landing on the project's **Welcome screen** (the mode fork: isolated worktree vs project folder).
 * Deliberately no workspace is auto-entered; the rail lists the built-in Default row (the list ensures
 * it host-side).
 */
export async function openFixtureProject(page: Page): Promise<void> {
	await openAppFresh(page);
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toBeVisible();
}

/**
 * From the project's Welcome, take the "Work in project folder" fork card — direct-enters the built-in
 * Default workspace (the project folder itself) and lands on the IDE surface.
 */
export async function enterDefaultWorkspace(page: Page): Promise<void> {
	await page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }).click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("center-tabs")).toBeVisible();
}

/** The built-in Default workspace's row (exactly one per open project in the rail). */
export function defaultWorkspaceRow(page: Page): Locator {
	return page.locator('[data-testid="workspace-item"][data-kind="default"]');
}

/** The *worktree* workspace rows — every workspace row minus the always-present Default. */
export function worktreeRows(page: Page): Locator {
	return page.locator('[data-testid="workspace-item"]:not([data-kind="default"])');
}

/** The *active* worktree row — the active workspace, excluding the always-present Default. */
export function activeWorktreeRow(page: Page): Locator {
	return worktreeRows(page).and(page.locator('[data-active="true"]'));
}

/**
 * Open a workspace row's kebab (`⋮`) menu — the "Open in" / Copy path / Reveal / Remove actions live
 * there, hover-revealed then click-opened, same as any Radix dropdown trigger.
 */
export async function openWorkspaceMenu(row: Locator): Promise<void> {
	await row.hover();
	await row.getByTestId("workspace-menu").click();
}

/** The "project home" gesture: click the project row to deselect the workspace → its Welcome screen. */
export async function goProjectHome(page: Page): Promise<void> {
	await page.getByTestId("project-item").first().getByText("sample-project").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
}

/**
 * Open the fixture project and create a workspace — leaving the dialog's auto-opened chat with its
 * composer ready (submitting the dialog always lands in a fresh chat; no separate start-chat step).
 * Creation is retried: when the `@agent` suite shares one host under load, an `add-workspace` click can
 * occasionally not register, so we re-click until a workspace becomes active (re-clicking only while none
 * exists, so we never spawn duplicates). Use this for any chat-driven spec.
 */
export async function openWorkspaceChat(page: Page): Promise<void> {
	await openFixtureProject(page);
	// Chat in a *worktree* workspace, never the project-folder Default (the shared fixture repo itself):
	// agent specs run bash/edits in the workspace cwd, and worktree isolation keeps them off the repo.
	await expect(async () => {
		if ((await worktreeRows(page).count()) === 0) {
			await createWorkspaceViaDialog(page);
		}
		// Activate it explicitly (a no-op when the dialog's create already did) — a lost activation would
		// otherwise never self-heal.
		await worktreeRows(page).first().getByRole("button").first().click();
		await expect(activeWorktreeRow(page)).toHaveCount(1, {
			timeout: 5_000,
		});
	}).toPass({ timeout: 30_000 });
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
}

/** Wait for the current round to finish (its "✓ Done" marker) so the transcript is stable. */
export async function waitForDone(page: Page, timeout = 90_000): Promise<void> {
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="system"]')
			.filter({ hasText: "Done" })
			.last(),
	).toBeVisible({ timeout });
}

/** Expand every collapsed activity group so the routine step rows exist in the DOM. */
export async function expandAllActivityGroups(page: Page): Promise<void> {
	const collapsed = page.locator('[data-testid="activity-group"][data-expanded="false"]');
	while ((await collapsed.count()) > 0) {
		await collapsed.first().getByTestId("activity-group-toggle").click();
	}
}

/**
 * Reveal + expand the first activity step for `tool`, returning its locator. Routine tools don't get
 * their own cards — they fold into collapsed activity groups (a single-step run renders its step row
 * directly) — so this expands the groups first, then the step, revealing its full renderer body.
 * Call after the round ended ({@link waitForDone}) so the fold set is stable.
 */
export async function expandActivityStep(page: Page, tool: string): Promise<Locator> {
	await expandAllActivityGroups(page);
	const step = page.locator(`[data-testid="activity-step"][data-tool="${tool}"]`).first();
	await expect(step).toBeVisible();
	if ((await step.getAttribute("data-expanded")) !== "true") {
		await step.getByTestId("activity-step-toggle").click();
		await expect(step).toHaveAttribute("data-expanded", "true");
	}
	return step;
}

/** The terminal layer currently shown (exactly one is `data-visible="true"` at a time). */
export function visibleTerminal(page: Page): Locator {
	return page.locator('[data-testid="terminal-instance"][data-visible="true"]');
}

/**
 * The visible terminal's rendered rows. Assert terminal *text* against this, never the container:
 * xterm appends hidden `.xterm-char-measure-element` width-probe spans (each `char.repeat(32)`, e.g.
 * 32×"E" / 32×"1") inside the terminal element, and `toContainText` on the container reads them too —
 * so before the shell output paints, the container text is a run of measure glyphs, not the command.
 * `.xterm-rows` holds only the painted screen, so assertions wait for the real output.
 */
export function visibleTerminalScreen(page: Page): Locator {
	return visibleTerminal(page).locator(".xterm-rows");
}

/** Wait until the visible terminal's PTY is wired up (ready to receive input). */
export async function waitTerminalReady(page: Page): Promise<void> {
	await expect(visibleTerminal(page)).toHaveAttribute("data-ready", "true");
}

/** Open an additional terminal and wait until its PTY is ready. */
export async function openTerminal(page: Page): Promise<void> {
	await page.getByTestId("terminal-add").click();
	await waitTerminalReady(page);
}

/** Type a command into the visible terminal and submit it. */
export async function runInTerminal(page: Page, command: string): Promise<void> {
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(command);
	await page.keyboard.press("Enter");
}
