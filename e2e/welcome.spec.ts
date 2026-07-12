import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	stagePlainFolder,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO, E2E_PLAIN_DIR } from "./fixtures/paths";

// The first-touch Welcome screen. It replaces the center/right/terminal surface until a workspace is
// active, and its cards adapt across three states:
//   1. no projects        → one "Open project" card (opens the same dropdown as the projects-rail "+")
//   2. project, has specs → "Start building" + "Open project"
//   3. project, no specs  → spec-first "Set up project" + "Start building" + "Open project"
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

	// State 1: a single "Open project" card, and no project eyebrow (no project selected yet).
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

test("an API key can be added and removed in Settings (round-trips through the host)", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	// Target the first unconfigured provider offering an inline API-key field (a single-key provider). The
	// dummy key isn't network-validated — `getAvailable()` is a fast check — so storing it flips the row to
	// configured deterministically. Clean up by signing out so the isolated agent dir doesn't leak state.
	const toggle = page.getByTestId("provider-apikey-toggle").first();
	await expect(toggle).toBeVisible();
	const providerId = await toggle.getAttribute("data-provider");
	expect(providerId).toBeTruthy();
	const sel = (testid: string) =>
		page.locator(`[data-testid="${testid}"][data-provider="${providerId}"]`);

	await toggle.click();
	await sel("provider-apikey-input").fill("sk-e2e-dummy-key");
	await sel("provider-apikey-save").click();

	// The pane re-reads status → the provider now shows as a configured (Connected) row with a Sign-out.
	const configuredRow = page.locator(
		`[data-testid="provider-row"][data-provider="${providerId}"][data-configured="true"]`,
	);
	await expect(configuredRow).toBeVisible();

	// Sign out removes the credential and re-reads → it's no longer configured.
	await sel("provider-signout").click();
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

test("Settings → Providers offers JetBrains AI, guiding install when the jbcentral CLI is missing", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	const card = page.getByTestId("jetbrains-ai-card");
	await expect(card).toBeVisible();
	await expect(card).toContainText("JetBrains AI");

	// The card's state depends on the host's jbcentral CLI (the e2e host has none → install guidance;
	// a dev machine with it wired/ready shows Disconnect/Connect). Accept whichever is truthful.
	if ((await card.getAttribute("data-installed")) === "false") {
		await expect(page.getByTestId("jetbrains-needs-install")).toBeVisible();
		await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
	} else if ((await card.getAttribute("data-wired")) === "true") {
		await expect(page.getByTestId("jetbrains-disconnect")).toBeVisible();
	} else {
		await expect(page.getByTestId("jetbrains-connect")).toBeVisible();
	}
});

test("a project with specs offers Start building over Set up", async ({ page }) => {
	// The fixture repo already carries SPEC.md files → the host reports it has specs.
	await openFixtureProject(page);

	await expect(page.getByTestId("welcome")).toBeVisible();
	// The active project's name shows as the eyebrow above the wordmark.
	await expect(page.getByTestId("welcome")).toContainText("sample-project");
	// Two cards: Start building (primary) + Open project — and no "Set up project".
	await expect(page.getByTestId("welcome-cta")).toContainText("Start building");
	await expect(
		page.getByTestId("welcome-action").filter({ hasText: "Open project" }),
	).toBeVisible();
	await expect(page.getByText("Set up project")).toHaveCount(0);
});

test("a project without specs suggests setting it up", async ({ page }) => {
	// Strip the fixture's specs so the host reports no specs, then restore them afterwards (the suite is
	// serial — workers: 1 — so this can't race, and git restores the exact committed content).
	for (const spec of FIXTURE_SPECS) rmSync(join(E2E_FIXTURE_REPO, spec), { force: true });
	try {
		await openFixtureProject(page);

		await expect(page.getByTestId("welcome")).toBeVisible();
		await expect(page.getByTestId("welcome")).toContainText("sample-project");
		// Three cards: Set up project (primary) + Start building + Open project.
		await expect(page.getByTestId("welcome-cta")).toContainText("Set up project");
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Start building" }),
		).toBeVisible();
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Open project" }),
		).toBeVisible();

		// "Set up project" opens the New-Workspace dialog with the prompt hero pre-seeded.
		await page.getByTestId("welcome-cta").click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("ws-prompt")).toHaveValue(/^\/skill:project-setup\b/);

		// Clear the seed (no agent kick-off — keeps this in the no-agent suite) and create the worktree; it
		// becomes active → the welcome unmounts and the full 3-column surface appears.
		await dialog.getByTestId("ws-prompt").fill("");
		await page.getByTestId("create-workspace").click();
		await expect(dialog).toBeHidden();
		await expect(page.getByTestId("welcome")).toHaveCount(0);
		await expect(page.getByTestId("center-tabs")).toBeVisible();
		await expect(page.getByTestId("right-panel")).toBeVisible();
		await expect(page.getByTestId("terminal-panel")).toBeVisible();
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

	// It initialises + opens → the folder now shows up as a project in the rail.
	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_PLAIN_DIR) }),
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
	await page.getByTestId("workspace-item").first().getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
});
