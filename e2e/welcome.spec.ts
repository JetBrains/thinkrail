import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openAppFresh, openFixtureProject } from "./fixtures/app";

// The first-touch Welcome screen — shown only when **no project is selected** (fresh install / after the
// last project is deselected). Once a project is selected the center shows the read-only project view
// (see project-view.spec); a workspace shows the 3-column IDE. Welcome carries the three unified project
// actions (Create new project / Open local project / Clone from GitHub — see create-project.spec).

test("opens a clean ThinkRail with no projects imported", async ({ page }) => {
	await openAppFresh(page);

	// The Welcome screen fills the app; the workspace surface is not mounted with no workspace active.
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	// State 1: the three unified project actions, "Create new project" as the CTA (no project yet).
	await expect(page.getByTestId("welcome-cta")).toContainText("Create new project");
	await expect(page.getByText("Open local project")).toBeVisible();
	await expect(page.getByText("Clone from GitHub")).toBeVisible();
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

test("Settings → Providers offers JetBrains AI, guiding install when the central CLI is missing", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	const card = page.getByTestId("jetbrains-ai-card");
	await expect(card).toBeVisible();
	await expect(card).toContainText("JetBrains AI");

	// The card's state depends on the host's central CLI (the e2e host has none → install guidance;
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

// (The non-git "initialize a repo" flow is now the mocked Open-local-project dialog — see
// create-project.spec's "Open local project" test.)

test("clicking a project opens its read-only view, not a workspace", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	// A workspace is active → the IDE surface is mounted.
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	// Clicking the project row now leaves the workspace for the project's read-only view (work happens in
	// isolated worktrees).
	await page.getByTestId("project-item").first().getByText("sample-project").click();
	await expect(page.getByTestId("project-view")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("welcome")).toHaveCount(0);

	// Re-entering a worktree is an explicit click on its workspace row.
	await page.getByTestId("workspace-item").first().getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.getByTestId("project-view")).toHaveCount(0);
});

test("the header logo opens the main welcome screen", async ({ page }) => {
	await openFixtureProject(page); // selects the project → read-only ProjectView, not Welcome
	await expect(page.getByTestId("project-view")).toBeVisible();

	// Clicking the top-left logo clears the selection back to the Welcome screen.
	await page.getByTestId("app-logo").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("project-view")).toHaveCount(0);
});
