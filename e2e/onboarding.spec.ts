import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { AppConfig } from "@thinkrail/contracts";
import { seedAnalyticsConsent } from "./fixtures/analyticsConsent";
import { openAppFresh } from "./fixtures/app";
import { openProviders } from "./fixtures/jbcentral";
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
	const fixture = scope.locator('[data-testid="provider-signin-row"][data-provider="e2e-apikey"]');
	const row =
		(await fixture.count()) > 0
			? fixture
			: scope
					.locator('[data-testid="provider-signin-row"]:has([data-testid="provider-apikey"])')
					.first();
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
	await expect(page.getByTestId("chat-input")).toHaveValue(SETUP_PROMPT);
	await expect(page.getByTestId("new-workspace-dialog")).toHaveCount(0);
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
	await expect(wizard.getByTestId("connect-provider-options")).toBeVisible();
	await expect(wizard.getByTestId("onboarding-steps")).toHaveCount(0);

	await expect(wizard.getByTestId("connect-detected")).toHaveCount(0);
	const list = wizard.getByTestId("connect-provider-list");
	const central = wizard
		.getByTestId("connect-detected-central")
		.or(list.getByTestId("jetbrains-ai-row"));
	await expect(central).toBeVisible();
	const rows = list.getByTestId("provider-signin-row");
	expect(await rows.count()).toBeGreaterThan(6);
	const anthropicRow = list.locator(
		'[data-testid="provider-signin-row"][data-provider="anthropic"]',
	);
	await expect(anthropicRow).toHaveCount(1);
	await expect(anthropicRow.getByTestId("provider-signin")).toHaveCount(1);
	await expect(anthropicRow.getByTestId("provider-apikey")).toHaveCount(0);
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
	await expect(list.getByTestId("jetbrains-ai-row")).toHaveCount(0);
	await search.fill("anthro");
	await expect(rows).toHaveCount(1);
	await expect(rows).toHaveAttribute("data-provider", "anthropic");
	await search.fill("jetbrains");
	await expect(central).toBeVisible();
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

test("Get started detects a signed-in Claude Code and offers its sign-in above the search", async ({
	page,
	baseURL,
}) => {
	const claudeConfig = join(E2E_HOME_DIR, ".claude", ".claude.json");
	mkdirSync(dirname(claudeConfig), { recursive: true });
	writeFileSync(
		claudeConfig,
		JSON.stringify({ oauthAccount: { accountUuid: "e2e", billingType: "stripe_subscription" } }),
	);
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
		const all = wizard.getByTestId("connect-provider-all");
		await expect(all.getByTestId("connect-option-detected")).toContainText("Sign in with Claude");
		const detectedBox = await all.getByTestId("connect-option-detected").boundingBox();
		const searchBox = await all.getByTestId("connect-provider-search").boundingBox();
		expect(detectedBox && searchBox && detectedBox.y < searchBox.y).toBe(true);
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

test("Get started asks about usage data as its own step before the models, or the shell asks after a skip", async ({
	page,
	baseURL,
}) => {
	await setOnboardingDismissed(baseURL, false);
	await seedAnalyticsConsent(baseURL, false, false);
	try {
		await openAppFresh(page);
		test.skip(
			await anyProviderConfigured(baseURL),
			"an ambient provider makes this host a warm start",
		);

		const wizard = page.getByTestId("onboarding-wizard");
		const consent = page.getByTestId("analytics-consent-dialog");
		await expect(wizard).toHaveAttribute("data-step", "intro");
		await expect(consent).toHaveCount(0);

		await wizard.getByTestId("onboarding-start").click();
		await expect(wizard).toHaveAttribute("data-step", "privacy");
		await expect(wizard.getByTestId("connect-provider-options")).toHaveCount(0);
		await expect(wizard.getByTestId("onboarding-skip")).toHaveCount(0);
		await expect(consent).toHaveCount(0);
		await wizard.getByTestId("analytics-toggle").click();
		await wizard.getByTestId("onboarding-privacy-continue").click();
		await expect(wizard).toHaveAttribute("data-step", "connect");
		await expect(wizard.getByTestId("connect-provider-options")).toBeVisible();
		await expect(consent).toHaveCount(0);
		await expect
			.poll(() => {
				const config = JSON.parse(
					readFileSync(join(E2E_DATA_DIR, "config.json"), "utf8"),
				) as AppConfig;
				return [config.analyticsEnabled, config.analyticsConsentConfirmed];
			})
			.toEqual([false, true]);

		await seedAnalyticsConsent(baseURL, false, false);
		await openAppFresh(page);
		await expect(wizard).toHaveAttribute("data-step", "intro");
		await wizard.getByTestId("onboarding-skip").click();
		await expect(wizard).toHaveCount(0);
		await expect(consent).toBeVisible();
	} finally {
		await seedAnalyticsConsent(baseURL, false, true);
	}
});

test("a failed usage-data save keeps the privacy step, its off choice and the error until a retry lands", async ({
	page,
	baseURL,
}) => {
	const config = join(E2E_DATA_DIR, "config.json");
	await setOnboardingDismissed(baseURL, false);
	await seedAnalyticsConsent(baseURL, false, false);
	try {
		await openAppFresh(page);
		test.skip(
			await anyProviderConfigured(baseURL),
			"an ambient provider makes this host a warm start",
		);

		const wizard = page.getByTestId("onboarding-wizard");
		await wizard.getByTestId("onboarding-start").click();
		await expect(wizard).toHaveAttribute("data-step", "privacy");
		const toggle = wizard.getByTestId("analytics-toggle");
		const readConfig = () => JSON.parse(readFileSync(config, "utf8")) as AppConfig;
		await expect.poll(() => readConfig().analyticsEnabled).toBe(true);
		const continueButton = wizard.getByTestId("onboarding-privacy-continue");
		await expect(continueButton).toBeEnabled();

		chmodSync(config, 0o400);
		await toggle.click();
		await expect(wizard.getByRole("alert")).toBeVisible();
		await continueButton.click();
		await expect(wizard.getByRole("alert")).toBeVisible();
		await expect(wizard).toHaveAttribute("data-step", "privacy");
		await expect(toggle).toHaveAttribute("aria-checked", "false");
		expect(readConfig().analyticsEnabled).toBe(true);

		chmodSync(config, 0o600);
		await continueButton.click();
		await expect(wizard).toHaveAttribute("data-step", "connect");
		expect([readConfig().analyticsEnabled, readConfig().analyticsConsentConfirmed]).toEqual([
			false,
			true,
		]);
	} finally {
		chmodSync(config, 0o600);
		await seedAnalyticsConsent(baseURL, false, true);
	}
});

test("a provider connected through Settings during the intro is verified on reaching Connect", {
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
		await expect(wizard).toHaveAttribute("data-step", "intro");
		await openProviders(page);
		providerId = await connectFirstApiKeyProvider(page, page.getByTestId("settings-providers"));
		await expect(page.getByTestId("login-success")).toBeVisible();
		await page.getByTestId("login-close").click();
		await expect(page.getByTestId("login-dialog")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("settings-dialog")).toHaveCount(0);

		await wizard.getByTestId("onboarding-start").click();
		await expect(wizard).toHaveAttribute("data-step", "done");
		await expect(wizard.getByTestId("welcome-connected")).toContainText(" connected");
	} finally {
		await signOut(baseURL, providerId);
	}
});

test("the onboarding wizard verifies the connection in place, then collapses to one line over the two project cards", {
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
		await expect(page.getByTestId("login-dialog")).toHaveCount(0);

		await expect(wizard).toHaveAttribute("data-step", "done");
		await expect(wizard.getByTestId("welcome-title")).toHaveText("You're set");
		await expect(wizard.getByTestId("welcome-connected")).toHaveText(
			/ connected · (.+ is the default model|\d+ models? available|the agent can run now)$/,
		);
		await expect(wizard.getByTestId("connect-provider-options")).toHaveCount(0);
		await expect(wizard.getByTestId("onboarding-skip")).toHaveCount(0);
		await expect(page.getByTestId("welcome-cta")).toContainText("Start a new project");
		await expect(page.getByTestId("welcome-action")).toHaveCount(1);
		await expect(page.getByTestId("welcome-action")).toContainText("Open project");
		await expect
			.poll(
				() =>
					(JSON.parse(readFileSync(join(E2E_DATA_DIR, "config.json"), "utf8")) as AppConfig)
						.onboardingDismissed,
			)
			.toBe(true);

		await page.getByTestId("welcome-cta").click();
		const dialog = page.getByTestId("create-project-dialog");
		await dialog.getByTestId("create-project-name").fill("wizard-app");
		await dialog.getByTestId("create-project-submit").click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByTestId("chat-input")).toHaveValue(SETUP_PROMPT);
		await expect(page.getByTestId("new-workspace-dialog")).toHaveCount(0);
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
		await expect(page.getByTestId("welcome-connected")).toContainText(" connected");
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
