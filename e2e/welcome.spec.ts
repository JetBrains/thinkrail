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
import { git } from "./fixtures/git";
import { E2E_FIXTURE_REPO, E2E_PLAIN_DIR } from "./fixtures/paths";

const FIXTURE_SPECS = ["SPEC.md", join("module-a", "SPEC.md")];

test("opens a clean ThinkRail with no projects imported", async ({ page }) => {
	await openAppFresh(page);

	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	await expect(page.getByTestId("welcome-title")).toHaveText("ThinkRail");
	await expect(page.getByTestId("welcome-cta")).toContainText("Open project");
	await expect(page.getByTestId("welcome-action")).toHaveCount(0);

	await page.getByTestId("welcome-cta").click();
	await expect(page.getByTestId("menu-open-project")).toBeVisible();
});

test("the Welcome provider warning only shows when no provider is connected, and opens Settings", async ({
	page,
}) => {
	await openAppFresh(page);

	const banner = page.getByTestId("welcome-provider-warning");
	if (await banner.isVisible()) {
		await expect(banner).toContainText("No model provider connected");
		await page.getByTestId("welcome-connect-provider").click();
		await expect(page.getByTestId("settings-dialog")).toBeVisible();
		await expect(page.getByTestId("settings-providers")).toBeVisible();
	} else {
		await expect(banner).toHaveCount(0);
	}
});

test("Settings → Providers lists in-app auth options", async ({ page }) => {
	await openAppFresh(page);

	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	const anyRow = page.getByTestId("provider-row").or(page.getByTestId("provider-signin-row"));
	await expect(anyRow.first()).toBeVisible();
	await expect(page.getByTestId("providers-error")).toHaveCount(0);
});

test("a real provider's API key round-trips through the login dialog (add in Settings, sign out)", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

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
			await option.click();
		} else if (await input.isVisible()) {
			await input.fill(`e2e-dummy-${i}`);
			await page.getByTestId("login-submit").click();
		} else {
			await page.waitForTimeout(200);
		}
	}
	await expect(page.getByTestId("login-success")).toBeVisible();
	await page.getByTestId("login-close").click();
	await expect(dialog).toHaveCount(0);

	const configuredRow = page.locator(
		`[data-testid="provider-row"][data-provider="${providerId}"][data-configured="true"]`,
	);
	await expect(configuredRow).toBeVisible();

	await page.locator(`[data-testid="provider-signout"][data-provider="${providerId}"]`).click();
	await expect(configuredRow).toHaveCount(0);
});

test("clicking Sign in (Settings) opens the in-app login dialog, and Cancel dismisses it", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	const signIn = page.getByTestId("provider-signin").first();
	await expect(signIn).toBeVisible();
	await signIn.click();

	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();

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
	await openFixtureProject(page);
	await expect(page.getByTestId("welcome-title")).toHaveText("sample-project");
	const scope = page.getByTestId("scope-context");
	await expect(scope).toHaveAttribute("data-context", "project-home");
	await expect(scope).toContainText("sample-project");
	await expect(scope).toContainText("Project home");
	await expect(page.getByTestId("welcome-cta")).toContainText("Start building");
	await expect(page.getByTestId("welcome-action")).toHaveCount(1);
	await expect(
		page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }),
	).toBeVisible();
	await expect(page.getByText("Set up project")).toHaveCount(0);
	await expect(page.getByTestId("welcome").getByText("Open project")).toHaveCount(0);
});

test("a project without specs suggests setting it up", async ({ page }) => {
	for (const spec of FIXTURE_SPECS) rmSync(join(E2E_FIXTURE_REPO, spec), { force: true });
	try {
		await openFixtureProject(page);
		await expect(page.getByTestId("welcome-title")).toHaveText("sample-project");
		await expect(page.getByTestId("welcome-cta")).toContainText("Set up project");
		await expect(page.getByTestId("welcome-action")).toHaveCount(2);
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Start building" }),
		).toBeVisible();
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Work in project folder" }),
		).toBeVisible();

		await page.getByTestId("welcome-cta").click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("ws-prompt")).toHaveValue("/skill:setting-up-a-project ");
		await expect(dialog.getByTestId("slash-menu")).toHaveCount(0);
		await expect(dialog.getByTestId("ws-target-worktree")).toHaveAttribute("data-active", "true");
		await expect(dialog.getByRole("heading", { name: "Start work" })).toBeVisible();
		await expect(dialog.getByTestId("ws-branch-picker")).toBeVisible();
		await expect(dialog.getByTestId("ws-prompt-note")).toContainText("setting-up-a-project skill");

		await dialog.getByTestId("ws-target-default").click();
		await expect(dialog).toContainText("No isolation");
		await expect(dialog.getByTestId("ws-branch-picker")).toHaveCount(0);

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
		git(E2E_FIXTURE_REPO, "checkout", "--", ...FIXTURE_SPECS);
	}
});

test("opening a non-git folder from the Welcome screen offers to initialise a repo", async ({
	page,
}) => {
	stagePlainFolder();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("welcome")).toBeVisible();

	await page.getByTestId("welcome-cta").click();
	await page.getByTestId("menu-open-project").click();

	const confirmInit = page.getByTestId("confirm-init-repo");
	await expect(confirmInit).toBeVisible();
	await confirmInit.click();

	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_PLAIN_DIR) }),
	).toBeVisible();
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
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(1);

	await page.getByTestId("project-item").first().getByText("sample-project").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.locator('[data-testid="workspace-item"][data-active="true"]')).toHaveCount(0);

	await worktreeRows(page).first().getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
});
