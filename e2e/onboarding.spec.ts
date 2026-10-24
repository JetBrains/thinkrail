import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { AppConfig } from "@thinkrail/contracts";
import { seedAnalyticsConsent } from "./fixtures/analyticsConsent";
import { openAppFresh } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_HOME_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const PROJECTS_PARENT = join(E2E_HOME_DIR, "thinkrail");
const SETUP_PROMPT = "/skill:setting-up-a-project ";

async function withWire<T>(
	baseURL: string | undefined,
	run: (wire: E2eWire) => Promise<T>,
): Promise<T> {
	if (!baseURL) throw new Error("Onboarding fixtures require the isolated host URL");
	const wire = await E2eWire.connect(Number(new URL(baseURL).port));
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
}

function setOnboardingDismissed(
	baseURL: string | undefined,
	onboardingDismissed: boolean,
): Promise<AppConfig> {
	return withWire(baseURL, (wire) =>
		wire.request("settings.update", { config: { onboardingDismissed } }),
	);
}

async function anyProviderConfigured(baseURL: string | undefined): Promise<boolean> {
	const report = await withWire(baseURL, (wire) => wire.request("provider.status", {}));
	return report.providers.some((p) => p.configured);
}

async function connectFirstApiKeyProvider(page: Page, scope: Locator): Promise<string> {
	const row = scope.locator('[data-testid="provider-signin-row"][data-provider="anthropic"]');
	const providerId = await row.getAttribute("data-provider");
	expect(providerId).toBeTruthy();
	await row.getByTestId("provider-apikey").click();

	await expect(page.getByTestId("login-dialog")).toBeVisible();
	for (let i = 0; i < 8; i++) {
		if (!(await page.getByTestId("login-dialog").isVisible())) break;
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
	return providerId ?? "";
}

function signOut(baseURL: string | undefined, providerId: string | null): Promise<unknown> {
	if (!providerId) return Promise.resolve();
	return withWire(baseURL, (wire) => wire.request("provider.logout", { providerId }));
}

test.afterEach(async ({ baseURL }) => {
	await setOnboardingDismissed(baseURL, true);
	rmSync(PROJECTS_PARENT, { recursive: true, force: true });
});

test("Start a new project creates the repo under ~/thinkrail and seeds the setup chat", async ({
	page,
}) => {
	await openAppFresh(page);

	await page.getByTestId("welcome-cta").filter({ hasText: "Start a new project" }).click();
	const dialog = page.getByTestId("create-project-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("create-project-parent")).toHaveValue("~/thinkrail");
	await dialog.getByTestId("create-project-name").fill("Weather App");
	await expect(dialog.getByTestId("create-project-path")).toHaveText("~/thinkrail/weather-app");
	await expect(dialog.getByTestId("create-project-setup")).toHaveAttribute("aria-checked", "true");
	await dialog.getByTestId("create-project-submit").click();

	await expect(dialog).toHaveCount(0);
	const workspaceDialog = page.getByTestId("new-workspace-dialog");
	await expect(workspaceDialog).toBeVisible();
	await expect(workspaceDialog.getByTestId("ws-prompt")).toHaveValue(SETUP_PROMPT);
	await expect(workspaceDialog.getByTestId("ws-branch-picker")).toContainText("main· local");
	expect(existsSync(join(PROJECTS_PARENT, "weather-app", ".git"))).toBe(true);
	await expect(page.getByTestId("project-item").filter({ hasText: "weather-app" })).toBeVisible();
});

test("the rail + starts a new project without the setup chat, and a taken folder errors inline", async ({
	page,
}) => {
	await openAppFresh(page);

	const create = async (name: string, setup: boolean) => {
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-start-new-project").click();
		const dialog = page.getByTestId("create-project-dialog");
		await dialog.getByTestId("create-project-name").fill(name);
		if (!setup) await dialog.getByTestId("create-project-setup").click();
		await dialog.getByTestId("create-project-submit").click();
		return dialog;
	};

	const first = await create("notes", false);
	await expect(first).toHaveCount(0);
	await expect(page.getByTestId("new-workspace-dialog")).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText("notes");
	await expect(page.getByTestId("welcome-cta")).toContainText("Set up project");

	const second = await create("notes", false);
	await expect(second.getByTestId("create-project-error")).toContainText("isn't empty");
	await expect(second).toBeVisible();
});

test("a cold start shows the onboarding wizard once; Skip setup persists", async ({
	page,
	baseURL,
}) => {
	await setOnboardingDismissed(baseURL, false);
	await openAppFresh(page);
	test.skip(
		await anyProviderConfigured(baseURL),
		"an ambient provider makes this host a warm start",
	);

	const wizard = page.getByTestId("onboarding-wizard");
	await expect(wizard).toHaveAttribute("data-step", "intro");
	await expect(wizard.getByTestId("welcome-title")).toHaveText("ThinkRail");
	await expect(page.getByTestId("left-nav")).toHaveCount(0);
	await expect(wizard.getByTestId("connect-provider-options")).toHaveCount(0);
	await wizard.getByTestId("onboarding-start").click();
	await expect(wizard).toHaveAttribute("data-step", "connect");
	await expect(wizard.getByTestId("onboarding-steps").locator("li")).toHaveCount(3);
	await expect(wizard.getByTestId("connect-provider-options")).toBeVisible();
	await expect(wizard.getByTestId("onboarding-steps")).toBeVisible();

	await expect(wizard.getByTestId("connect-option-recommended")).toHaveCount(0);
	const list = wizard.getByTestId("connect-provider-list");
	await expect(list.getByTestId("jetbrains-ai-card")).toBeVisible();
	const rows = list.getByTestId("provider-signin-row");
	expect(await rows.count()).toBeGreaterThan(6);
	await expect(
		list.locator('[data-testid="provider-signin-row"][data-provider="anthropic"]'),
	).toHaveCount(1);
	const oauthFirst = await rows.evaluateAll((els) =>
		els.map((e) => e.querySelector('[data-testid="provider-signin"]') !== null),
	);
	expect(oauthFirst).toEqual([...oauthFirst].sort((a, b) => Number(b) - Number(a)));
	const search = wizard.getByTestId("connect-provider-search");
	const listHeight = (await list.boundingBox())?.height;
	await search.fill("cerebras");
	await expect(rows).toHaveCount(1);
	await expect(rows).toHaveAttribute("data-provider", "cerebras");
	await expect(rows.getByTestId("provider-signin")).toHaveCount(0);
	await rows.getByTestId("provider-apikey").click();
	await expect(page.getByTestId("login-dialog")).toBeVisible();
	await page.getByTestId("login-cancel").click();
	await expect(page.getByTestId("login-dialog")).toHaveCount(0);
	await expect(list.getByTestId("jetbrains-ai-card")).toHaveCount(0);
	await search.fill("anthro");
	await expect(rows).toHaveCount(1);
	await expect(rows).toHaveAttribute("data-provider", "anthropic");
	await search.fill("jetbrains");
	await expect(list.getByTestId("jetbrains-ai-card")).toBeVisible();
	await expect(rows).toHaveCount(0);
	await search.fill("no-such-provider");
	await expect(list).toContainText("No providers match");
	expect((await list.boundingBox())?.height).toBe(listHeight);

	await wizard.getByTestId("onboarding-skip").click();
	await expect(wizard).toHaveCount(0);
	await expect(page.getByTestId("welcome-cta")).toContainText("Start a new project");
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect
		.poll(
			() =>
				(JSON.parse(readFileSync(join(E2E_DATA_DIR, "config.json"), "utf8")) as AppConfig)
					.onboardingDismissed,
		)
		.toBe(true);

	await page.reload();
	await expect(page.getByTestId("welcome-cta")).toContainText("Start a new project");
	await expect(page.getByTestId("onboarding-wizard")).toHaveCount(0);
});

test("Get started detects a signed-in Claude Code and recommends its sign-in", async ({
	page,
	baseURL,
}) => {
	const claudeConfig = join(E2E_HOME_DIR, ".claude", ".claude.json");
	mkdirSync(dirname(claudeConfig), { recursive: true });
	writeFileSync(claudeConfig, JSON.stringify({ oauthAccount: { accountUuid: "e2e" } }));
	try {
		await setOnboardingDismissed(baseURL, false);
		await openAppFresh(page);
		test.skip(
			await anyProviderConfigured(baseURL),
			"an ambient provider makes this host a warm start",
		);

		const wizard = page.getByTestId("onboarding-wizard");
		await wizard.getByTestId("onboarding-start").click();
		const detected = wizard.getByTestId("connect-detected");
		await expect(detected).toHaveCount(1);
		await expect(detected).toHaveAttribute("data-source", "claude-code");
		await expect(detected).toHaveAttribute("data-provider", "anthropic");
		await expect(wizard.getByTestId("connect-option-recommended")).toContainText(
			"Sign in with Claude",
		);
		await expect(
			wizard.getByTestId("connect-provider-list").locator('[data-provider="anthropic"]'),
		).toHaveCount(0);

		await detected.click();
		await expect(page.getByTestId("login-dialog")).toHaveAttribute("data-provider", "anthropic");
		await page.getByTestId("login-cancel").click();
		await expect(page.getByTestId("login-dialog")).toHaveCount(0);
	} finally {
		rmSync(claudeConfig, { force: true });
	}
});

test("the analytics consent prompt waits until the wizard ends", async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	await seedAnalyticsConsent(baseURL, false, false);
	try {
		await openAppFresh(page);
		test.skip(
			await anyProviderConfigured(baseURL),
			"an ambient provider makes this host a warm start",
		);

		const wizard = page.getByTestId("onboarding-wizard");
		await expect(wizard).toHaveAttribute("data-step", "intro");
		await expect(page.getByTestId("analytics-consent-dialog")).toHaveCount(0);

		await wizard.getByTestId("onboarding-skip").click();
		await expect(wizard).toHaveCount(0);
		await expect(page.getByTestId("analytics-consent-dialog")).toBeVisible();
	} finally {
		await seedAnalyticsConsent(baseURL, false, true);
	}
});

test("the onboarding wizard walks connect → verify → project → build", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	await openAppFresh(page);
	test.skip(
		await anyProviderConfigured(baseURL),
		"an ambient provider makes this host a warm start",
	);

	const wizard = page.getByTestId("onboarding-wizard");
	let providerId: string | null = null;
	try {
		await wizard.getByTestId("onboarding-start").click();
		providerId = await connectFirstApiKeyProvider(page, wizard);
		await expect(wizard).toHaveAttribute("data-step", "verify");
		await expect(page.getByTestId("login-dialog")).toHaveCount(0);
		await expect(wizard.getByTestId("onboarding-verify")).toBeVisible();
		await expect(
			wizard.getByTestId("onboarding-steps").locator('[data-step="connect"]'),
		).toHaveAttribute("data-state", "current");
		await wizard.getByTestId("onboarding-continue").click();

		await expect(wizard).toHaveAttribute("data-step", "project");
		await wizard.getByTestId("welcome-cta").filter({ hasText: "Start a new project" }).click();
		const dialog = page.getByTestId("create-project-dialog");
		await expect(dialog.getByTestId("create-project-setup")).toHaveCount(0);
		await dialog.getByTestId("create-project-name").fill("wizard-app");
		await dialog.getByTestId("create-project-submit").click();

		await expect(wizard).toHaveAttribute("data-step", "build");
		await expect(wizard.getByTestId("welcome-title")).toHaveText("wizard-app is ready");
		await wizard.getByTestId("welcome-cta").filter({ hasText: "Set up project" }).click();

		await expect(wizard).toHaveCount(0);
		const workspaceDialog = page.getByTestId("new-workspace-dialog");
		await expect(workspaceDialog.getByTestId("ws-prompt")).toHaveValue(SETUP_PROMPT);
	} finally {
		await signOut(baseURL, providerId);
	}
});

test("connecting from the Welcome banner closes the stack, toasts, and hands off", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await openAppFresh(page);
	const banner = page.getByTestId("welcome-provider-warning");
	test.skip(await anyProviderConfigured(baseURL), "an ambient provider hides the banner");

	let providerId: string | null = null;
	try {
		await page.getByTestId("welcome-connect-provider").click();
		const dialog = page.getByTestId("connect-provider-dialog");
		providerId = await connectFirstApiKeyProvider(page, dialog);

		await expect(dialog).toHaveCount(0);
		await expect(page.getByTestId("login-dialog")).toHaveCount(0);
		await expect(page.getByTestId("toast").filter({ hasText: "connected" })).toBeVisible();
		await expect(page.getByTestId("welcome-title")).toHaveText("You're set");
		await expect(banner).toHaveCount(0);
	} finally {
		await signOut(baseURL, providerId);
	}
});

test("a sign-in abandoned by a reload does not park the next attempt on Working…", async ({
	page,
	baseURL,
}) => {
	await openAppFresh(page);
	test.skip(await anyProviderConfigured(baseURL), "an ambient provider hides the banner");

	const startAnthropicSignIn = async () => {
		await page.getByTestId("welcome-connect-provider").click();
		await page
			.getByTestId("connect-provider-dialog")
			.locator('[data-testid="provider-signin-row"][data-provider="anthropic"]')
			.getByTestId("provider-signin")
			.click();
		await expect(page.getByTestId("login-option").first()).toBeVisible();
	};

	await startAnthropicSignIn();
	await page.reload();
	await startAnthropicSignIn();
	await page.getByTestId("login-cancel").click();
	await expect(page.getByTestId("login-dialog")).toHaveCount(0);
});
