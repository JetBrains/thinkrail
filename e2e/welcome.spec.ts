import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	stagePlainFolder,
	worktreeRows,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO, E2E_PLAIN_DIR } from "./fixtures/paths";

// The first-touch Welcome screen. It replaces the workspace workbench until a workspace is
// active — and with a project shown it is THE MODE FORK: "Start building" (isolated worktree) always
// sits beside "Work in project folder" (the built-in Default workspace), so the two working modes are a
// visible choice, not a hidden default. Opening a project lands here (no auto-enter). The hero heading is
// the shown project's name (the ThinkRail wordmark only with no project), and there is no pitch prose.
// Cards by state:
//   1. no projects        → one "Open project" card (opens the same dropdown as the projects-rail "+")
//   2. project, has specs → "Start building" + "Work in project folder"
//   3. project, no specs  → spec-first "Set up project" + "Start building" + "Work in project folder"
// "Open project" is NOT offered once a project is shown — that gesture lives on the projects-rail "+".
// "Has specs" = the repo has ANY registered spec (a file with id+type frontmatter), via the spec index —
// not a lowercased goal-and-requirements.md filename. The fixture ships SPEC.md files, so it's "has specs"
// by default; state 3 is exercised by stripping those specs for the duration of one test.

// The fixture's committed specs — removed to force the "needs setup" state, restored via git afterwards.
const FIXTURE_SPECS = ["SPEC.md", join("module-a", "SPEC.md")];

test("opens a clean ThinkRail with no projects imported", async ({ page }) => {
	await openAppFresh(page);

	// The Welcome screen fills the app; the workspace surface is not mounted with no workspace active.
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	// State 1: the wordmark hero (no project) and a single "Open project" card.
	await expect(page.getByTestId("welcome-title")).toHaveText("ThinkRail");
	await expect(page.getByTestId("welcome-cta")).toContainText("Open project");
	await expect(page.getByTestId("welcome-action")).toHaveCount(0);

	// The "Open project" card opens the same dropdown as the projects-rail "+".
	await page.getByTestId("welcome-cta").click();
	await expect(page.getByTestId("menu-open-project")).toBeVisible();
});

test("the Welcome provider warning only shows when no provider is connected, and opens Settings", async ({
	page,
}) => {
	await openAppFresh(page);

	// Provider auth now lives in Settings; the Welcome screen carries only a slim warning, shown ONLY when no
	// provider is connected. Whether it shows depends on the machine (globalSetup copies real pi auth into the
	// isolated agent dir when present; CI has none), so branch on it.
	const banner = page.getByTestId("welcome-provider-warning");
	if (await banner.isVisible()) {
		await expect(banner).toContainText("No model provider connected");
		// Its CTA opens Settings on the Providers section.
		await page.getByTestId("welcome-connect-provider").click();
		await expect(page.getByTestId("settings-dialog")).toBeVisible();
		await expect(page.getByTestId("settings-providers")).toBeVisible();
	} else {
		// A provider is configured → the warning is correctly absent.
		await expect(banner).toHaveCount(0);
	}
});

test("Settings → Providers lists in-app auth options", async ({ page }) => {
	await openAppFresh(page);

	// Open Settings from the top-bar gear — it lands on the Providers section (pi always registers its
	// built-ins, so there's always a configured row and/or an in-app sign-in row).
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	const anyRow = page.getByTestId("provider-row").or(page.getByTestId("provider-signin-row"));
	await expect(anyRow.first()).toBeVisible();
	await expect(page.getByTestId("providers-error")).toHaveCount(0);
});

test("a real provider's API key round-trips through the login dialog (add in Settings, sign out)", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	// Drive the FIRST unconfigured builtin through the interactive key flow (#97) — unlike
	// provider-apikey.spec's fake, this exercises a real provider's own login metadata (machine-agnostic:
	// whatever isn't configured in the copied auth). The provider-owned flow may ask one prompt or several
	// (bedrock/azure-style), so answer whatever arrives until it settles. Dummy values aren't
	// network-validated — `getAvailable()` is a fast local check — so the row flips to configured
	// deterministically. Clean up by signing out so the isolated agent dir doesn't leak state.
	const keyBtn = page.getByTestId("provider-apikey").first();
	await expect(keyBtn).toBeVisible();
	const providerId = await keyBtn.getAttribute("data-provider");
	expect(providerId).toBeTruthy();
	await keyBtn.click();

	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	for (let i = 0; i < 8; i++) {
		if (await page.getByTestId("login-success").isVisible()) break;
		const option = page.getByTestId("login-option").first();
		const input = page.getByTestId("login-input");
		if (await option.isVisible()) {
			await option.click(); // a select frame (e.g. a region choice) — any option works for a dummy setup
		} else if (await input.isVisible()) {
			await input.fill(`e2e-dummy-${i}`);
			await page.getByTestId("login-submit").click();
		} else {
			await page.waitForTimeout(200); // between frames — wait for the next prompt or the terminal state
		}
	}
	await expect(page.getByTestId("login-success")).toBeVisible();
	await page.getByTestId("login-close").click();
	await expect(dialog).toHaveCount(0);

	// The pane re-reads status → the provider now shows as a configured (Connected) row with a Sign-out.
	const configuredRow = page.locator(
		`[data-testid="provider-row"][data-provider="${providerId}"][data-configured="true"]`,
	);
	await expect(configuredRow).toBeVisible();

	// Sign out removes the credential and re-reads → it's no longer configured.
	await page.locator(`[data-testid="provider-signout"][data-provider="${providerId}"]`).click();
	await expect(configuredRow).toHaveCount(0);
});

test("clicking Sign in (Settings) opens the in-app login dialog, and Cancel dismisses it", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	// An OAuth-capable unconfigured provider offers a Sign-in button; clicking it starts the flow
	// (`provider.loginStart`) and opens the modal — regardless of whether a provider frame has streamed yet.
	const signIn = page.getByTestId("provider-signin").first();
	await expect(signIn).toBeVisible();
	await signIn.click();

	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();

	// Cancel aborts the flow (`provider.loginCancel`) and closes the modal.
	await page.getByTestId("login-cancel").click();
	await expect(dialog).toHaveCount(0);
});

test("Settings → Providers offers JetBrains AI with host-authoritative Central guidance", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	const card = page.getByTestId("jetbrains-ai-card");
	await expect(card).toBeVisible();
	await expect(card).toContainText("JetBrains AI");

	// Branch on the host's real Central state; 00-jbcentral.spec covers each transition.
	if ((await card.getAttribute("data-installed")) === "false") {
		await expect(page.getByTestId("jetbrains-needs-install")).toBeVisible();
		await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
	} else if ((await card.getAttribute("data-configured")) === "true") {
		await expect(page.getByTestId("jetbrains-disconnect")).toBeVisible();
	} else {
		await expect(page.getByTestId("jetbrains-connect")).toBeVisible();
	}
});

test("a project with specs offers Start building over Set up, beside the project-folder fork", async ({
	page,
}) => {
	// The fixture repo already carries SPEC.md files → the host reports it has specs. Opening lands
	// directly on the project's Welcome — the fork surface (no auto-enter).
	await openFixtureProject(page);
	// The active project's name IS the hero heading (the wordmark only shows with no project).
	await expect(page.getByTestId("welcome-title")).toHaveText("sample-project");
	// The global context makes the selected-but-not-active state explicit.
	const scope = page.getByTestId("scope-context");
	await expect(scope).toHaveAttribute("data-context", "project-home");
	await expect(scope).toContainText("sample-project");
	await expect(scope).toContainText("Project home");
	// Two cards: Start building (primary) + the project-folder fork — no "Set up project", and no "Open
	// project" (that gesture is the projects-rail "+" once a project is shown).
	await expect(page.getByTestId("welcome-cta")).toContainText("Start building");
	await expect(page.getByTestId("welcome-action")).toHaveCount(1);
	await expect(
		page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }),
	).toBeVisible();
	await expect(page.getByText("Set up project")).toHaveCount(0);
	await expect(page.getByTestId("welcome").getByText("Open project")).toHaveCount(0);
});

test("a project without specs suggests setting it up", async ({ page }) => {
	// Strip the fixture's specs so the host reports no specs, then restore them afterwards (the suite is
	// serial — workers: 1 — so this can't race, and git restores the exact committed content).
	for (const spec of FIXTURE_SPECS) rmSync(join(E2E_FIXTURE_REPO, spec), { force: true });
	try {
		await openFixtureProject(page); // lands on the project's Welcome — the spec-first cards
		await expect(page.getByTestId("welcome-title")).toHaveText("sample-project");
		// Three cards: Set up project (primary) + Start building + the project-folder fork (no "Open project").
		await expect(page.getByTestId("welcome-cta")).toContainText("Set up project");
		await expect(page.getByTestId("welcome-action")).toHaveCount(2);
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Start building" }),
		).toBeVisible();
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }),
		).toBeVisible();

		// "Set up project" opens the dialog pre-seeded with the skill command, preselected to the
		// isolated-worktree target (like every other Welcome entry point) with its base-branch picker, plus
		// the explanatory note (the header only names the create op).
		await page.getByTestId("welcome-cta").click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		// The seed is a *completed* command (trailing space, the completion's own insertion format), so the
		// slash-command menu doesn't pop open over the seeded hero.
		await expect(dialog.getByTestId("ws-prompt")).toHaveValue("/skill:setting-up-a-project ");
		await expect(dialog.getByTestId("slash-menu")).toHaveCount(0);
		await expect(dialog.getByTestId("ws-target-worktree")).toHaveAttribute("data-active", "true");
		await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();
		await expect(dialog.getByTestId("ws-branch-picker")).toBeVisible();
		await expect(dialog.getByTestId("ws-prompt-note")).toContainText("setting-up-a-project skill");

		// The folder alternative stays one click away: switching to Project folder swaps the header and
		// hides the branch picker (nothing gets created in that mode).
		await dialog.getByTestId("ws-target-default").click();
		await expect(dialog.getByRole("heading", { name: "Work in project folder" })).toBeVisible();
		await expect(dialog).toContainText("no isolation");
		await expect(dialog.getByTestId("ws-branch-picker")).toHaveCount(0);

		// Clear the seed (no agent kick-off — keeps this in the no-agent suite) and Start → no worktree is
		// created; the project's built-in Default workspace becomes active → the welcome unmounts and the
		// full 3-column surface appears, scoped to the project folder itself.
		await dialog.getByTestId("ws-prompt").fill("");
		await expect(page.getByTestId("create-workspace")).toHaveText(/Start/);
		await page.getByTestId("create-workspace").click();
		await expect(dialog).toBeHidden();
		await expect(page.getByTestId("welcome")).toHaveCount(0);
		await expect(page.getByTestId("center-tabs")).toBeVisible();
		await expect(page.getByTestId("right-panel")).toBeVisible();
		await expect(page.getByTestId("terminal-panel")).toBeVisible();
		await expect(
			page.locator('[data-testid="workspace-item"][data-kind="default"]'),
		).toHaveAttribute("data-active", "true");
		await expect(worktreeRows(page)).toHaveCount(0);
	} finally {
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "checkout", "--", ...FIXTURE_SPECS]);
	}
});

test("opening a non-git folder from the Welcome screen offers to initialise a repo", async ({
	page,
}) => {
	// Point the stubbed picker at a plain (non-git) folder; start with no projects → the Welcome screen.
	stagePlainFolder();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("welcome")).toBeVisible();

	// The Welcome "Open project" card opens the same dropdown as the rail's "+"; pick the folder.
	await page.getByTestId("welcome-cta").click();
	await page.getByTestId("menu-open-project").click();

	// The folder isn't a git repo → instead of failing silently, the Welcome flow offers to initialise one.
	const confirmInit = page.getByTestId("confirm-init-repo");
	await expect(confirmInit).toBeVisible();
	await confirmInit.click();

	// It initialises + opens → the folder now shows up as a project in the rail…
	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_PLAIN_DIR) }),
	).toBeVisible();
	// …and lands on the fresh project's Welcome (no auto-enter): the just-initialised repo has no specs,
	// so the spec-first funnel leads, with the project-folder fork beside it.
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText(basename(E2E_PLAIN_DIR));
	await expect(page.getByTestId("welcome-cta")).toContainText("Set up project");
	await expect(
		page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }),
	).toBeVisible();
});

test("clicking a project returns to its Welcome, deselecting the active workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	// A workspace is active → the IDE surface is mounted, not the Welcome.
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	// Clicking the project row is a "project home" gesture: back to its Welcome, workspace deselected.
	await page.getByTestId("project-item").first().getByText("sample-project").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(0);

	// Re-selecting the workspace restores the IDE (its tabs/session survive the deselect).
	await worktreeRows(page).first().getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
});
