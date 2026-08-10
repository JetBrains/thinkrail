import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Project } from "@thinkrail/contracts";
import { goProjectHome, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";
import {
	addBareRemote,
	deleteUpstreamBranch,
	pushUpstreamCommit,
	removeBareRemote,
} from "./fixtures/repo";

// The remote-awareness feature end to end: the Settings surface (Task 9's own `GitSettings`) and the
// background scheduler + `↓` indicator it drives (Tasks 3-8), against a real (local, bare) remote. No
// wall-clock sleeps: the scheduler's background check is driven by deliberate, deterministic triggers —
// `page.reload()` (a fresh WS connection → `noteClientActivity`) and a Settings **mode change**
// (`configureRemoteChecks` sweeps every project when the mode itself changes). Each spec uses exactly ONE
// of them, with every precondition (trust, the upstream state under test) in place beforehand. Never two:
// they share a 60s per-project floor that would swallow the second, and a reload layered on top of an
// in-flight check drops the `project.remoteState` push carrying its answer.

/** The fixture project's persisted id (`resetState`, run by `openFixtureProject`, wipes `projects.json`
 * first, so this always reads the current test's fresh project, never a stale one from an earlier test). */
function fixtureProjectId(): string {
	const projects = JSON.parse(
		readFileSync(join(E2E_DATA_DIR, "projects.json"), "utf8"),
	) as Project[];
	const project = projects.find((p) => p.name === "sample-project");
	if (!project) throw new Error("fixture project not found in projects.json");
	return project.id;
}

/** Whether the trust ledger (`remotes.json`, server-only) already has an `origin` entry for this project —
 * set once a user-initiated operation authenticates successfully (credential-ladder rung 2). Mirrors
 * `persistence.ts`'s own NUL-joined `trustKey`; read directly off disk rather than over a second WS
 * connection, since opening one would itself consume the scheduler's per-project floor. */
function isOriginTrusted(projectId: string): boolean {
	try {
		const record = JSON.parse(readFileSync(join(E2E_DATA_DIR, "remotes.json"), "utf8")) as Record<
			string,
			string
		>;
		return typeof record[`${projectId}\0origin`] === "string";
	} catch {
		return false;
	}
}

/**
 * Wait for the fire-and-forget `git.prefetch` the New Workspace dialog sent when it resolved
 * `origin/main` as the default branch to land — the deterministic proof a brand-new remote has crossed
 * credential-ladder rung 2, so the automatic scheduler is now allowed to touch it. A bounded poll of the
 * on-disk ledger, not a sleep: there is no UI signal for this (the indicator itself doesn't exist yet —
 * it renders nothing until a check has completed at least once).
 */
async function waitForOriginTrust(projectId: string): Promise<void> {
	await expect
		.poll(() => isOriginTrusted(projectId), {
			timeout: 15_000,
			message: "origin never became trusted (git.prefetch never completed)",
		})
		.toBe(true);
}

/**
 * Open the New Workspace dialog and create a worktree from `origin/main` — the dialog's `useBranchList`
 * resolves it as the default the moment `addBareRemote` has seeded the local `refs/remotes/origin/main`
 * tracking ref, so no explicit branch pick is needed. This is also what fires the automatic prefetch
 * `waitForOriginTrust` then confirms.
 */
async function createWorkspaceFromOriginMain(page: Page): Promise<void> {
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-branch-picker")).toContainText("origin/main");
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(1);
}

/** The created worktree's rail-row `↓` indicator (Task 8's `RemoteIndicator`, `testid="workspace-remote"`). */
function workspaceRemoteIndicator(page: Page) {
	return worktreeRows(page).first().getByTestId("workspace-remote");
}

test("probe mode: an upstream move surfaces a bare ↓, never a count and never nothing", async ({
	page,
}) => {
	const barePath = addBareRemote();
	try {
		await openFixtureProject(page);
		const projectId = fixtureProjectId();
		await createWorkspaceFromOriginMain(page);
		await waitForOriginTrust(projectId);

		// Someone else pushes upstream. The local `refs/remotes/origin/main` stays exactly where it was —
		// only the ONE deliberate WS-open below (the reload) may trigger the check that notices.
		pushUpstreamCommit(barePath);

		await page.reload();
		await goProjectHome(page);
		const indicator = workspaceRemoteIndicator(page);
		// Probe mode sees THAT the ref moved but not by how much: the bare glyph, deliberately never
		// `↓·0` (a fetch-mode claim a probe cannot make) and never absent (which would silently claim
		// "up to date").
		await expect(indicator).toHaveAttribute("data-behind", "unknown", { timeout: 15_000 });
		await expect(indicator).toHaveAttribute("data-dormant", "");
		await expect(indicator).toHaveText("↓");
	} finally {
		removeBareRemote(barePath);
	}
});

test("fetch mode: an upstream move by one commit surfaces an exact ↓·1", async ({ page }) => {
	const barePath = addBareRemote();
	try {
		await openFixtureProject(page);
		const projectId = fixtureProjectId();
		await createWorkspaceFromOriginMain(page);
		await waitForOriginTrust(projectId);

		// The upstream move goes in FIRST, and the mode switch is this spec's ONE trigger — no reload.
		// A **mode change is itself a check trigger** now (`configureRemoteChecks` sweeps every project the
		// moment the mode changes, so a pair's published state can't keep describing the old mode for a
		// whole backstop interval). Reloading on top of it would be a second trigger the 60s floor
		// suppresses, and — the actual flake — it would tear down the socket while the sweep's fetch was
		// still in flight, dropping the `project.remoteState` push that carries the answer. Staying
		// connected instead exercises that live push path, which is how a real client learns this.
		pushUpstreamCommit(barePath);

		// Switch to fetch mode via the Settings UI (this task's own `GitSettings`) — same
		// `settings.update` → `applyConfig` path the round-trip spec below pins directly.
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-git").click();
		const fetchOption = page.getByTestId("git-remote-check-mode-fetch");
		await fetchOption.click();
		await expect(fetchOption).toHaveAttribute("data-active", "true");
		await page.keyboard.press("Escape");

		await goProjectHome(page);
		const indicator = workspaceRemoteIndicator(page);
		// Only a real fetch can count: an exact, singular ↓·1.
		await expect(indicator).toHaveAttribute("data-behind", "1", { timeout: 15_000 });
		await expect(indicator).toHaveAttribute("data-dormant", "");
		await expect(indicator).toHaveText("↓·1");
	} finally {
		removeBareRemote(barePath);
		// Restore the default so no later spec inherits fetch mode (mirrors privacy.spec.ts's own
		// "restore the default" pattern).
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-git").click();
		const probeOption = page.getByTestId("git-remote-check-mode-probe");
		await probeOption.click();
		await expect(probeOption).toHaveAttribute("data-active", "true");
		await page.keyboard.press("Escape");
	}
});

test("a deleted upstream branch surfaces the upstream-gone warning, never bare absence", async ({
	page,
}) => {
	const barePath = addBareRemote();
	try {
		await openFixtureProject(page);
		const projectId = fixtureProjectId();
		await createWorkspaceFromOriginMain(page);
		await waitForOriginTrust(projectId);

		// The base branch is deleted upstream — typically a merged PR. This is the case a Critical review
		// finding exists to protect: "behind by some amount" is a nonsensical reading of a branch that no
		// longer exists, and it must never be swallowed as bare absence (indistinguishable from "up to
		// date") — it renders its own warning treatment instead.
		deleteUpstreamBranch(barePath);

		await page.reload();
		await goProjectHome(page);
		const indicator = workspaceRemoteIndicator(page);
		// Asserting an attribute at all already proves the indicator EXISTS (a `null`-returning component
		// leaves no element in the DOM for `toHaveAttribute` to find) — the property under test.
		await expect(indicator).toHaveAttribute("data-dormant", "upstream-gone", { timeout: 15_000 });
		await expect(indicator).toHaveAttribute("data-behind", "null");
		await expect(indicator).toHaveAttribute("aria-label", /no longer exists on the remote/);
	} finally {
		removeBareRemote(barePath);
	}
});

test("the Git settings section changes the remote-check mode and it survives a reload", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-git").click();

	const probeOption = page.getByTestId("git-remote-check-mode-probe");
	const fetchOption = page.getByTestId("git-remote-check-mode-fetch");
	await expect(probeOption).toHaveAttribute("data-active", "true"); // the default

	await fetchOption.click();
	await expect(fetchOption).toHaveAttribute("data-active", "true");
	await expect(probeOption).toHaveAttribute("data-active", "false");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-git").click();
	// The case that would catch `applyConfig` silently dropping the new fields: without them destructured
	// there, a reload's `server.welcome` fold never re-applies `gitRemoteCheck`, and the store's bare
	// initial default ("probe") would incorrectly still show active here instead of the persisted "fetch".
	await expect(page.getByTestId("git-remote-check-mode-fetch")).toHaveAttribute(
		"data-active",
		"true",
	);

	// Restore the default so no later spec inherits fetch mode.
	await page.getByTestId("git-remote-check-mode-probe").click();
	await expect(page.getByTestId("git-remote-check-mode-probe")).toHaveAttribute(
		"data-active",
		"true",
	);
	await page.keyboard.press("Escape");
});
