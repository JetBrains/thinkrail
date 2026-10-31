import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { AppConfig } from "@thinkrail/contracts";
import { removeTree } from "@thinkrail/shared/removeTree";
import { seedAnalyticsConsent } from "./fixtures/analyticsConsent";
import { openAppFresh, resetApp } from "./fixtures/app";
import { openProviders } from "./fixtures/jbcentral";
import { E2E_DATA_DIR, E2E_HOME_DIR, E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const PROJECTS_PARENT = join(E2E_HOME_DIR, "thinkrail");
const CONFIG_PATH = join(E2E_DATA_DIR, "config.json");
const SETUP_PROMPT = "/skill:setting-up-a-project ";

function readConfig(): AppConfig | undefined {
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AppConfig;
	} catch {
		return undefined;
	}
}

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

async function signOutEveryProvider(wire: E2eWire): Promise<void> {
	const report = await wire.request("provider.status", {});
	for (const p of report.providers) {
		if (p.canLogout) await wire.request("provider.logout", { providerId: p.id });
	}
}

async function openColdStart(page: Page, baseURL: string | undefined): Promise<void> {
	await resetApp(page);
	const report = await withWire(baseURL, async (wire) => {
		await expect
			.poll(async () => (await wire.request("provider.status", {})).jbcentral.state, {
				timeout: 15_000,
			})
			.not.toBe("configuring");
		await signOutEveryProvider(wire);
		return wire.request("provider.status", {});
	});
	const configured = report.providers.filter((p) => p.configured);
	test.skip(
		configured.length > 0 && configured.every((p) => p.kind === "env"),
		"an ambient env provider makes this host a warm start",
	);
	expect(configured.map((p) => p.id)).toEqual([]);
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

async function connectE2eKeyProvider(page: Page, scope: Locator): Promise<void> {
	const row = scope.locator('[data-testid="provider-signin-row"][data-provider="e2e-apikey"]');
	const showMore = scope.getByTestId("providers-show-more");
	await expect(row.or(showMore).first()).toBeVisible();
	if (await showMore.isVisible()) await showMore.click();
	await row.getByTestId("provider-apikey").click();
	await expect(page.getByTestId("login-dialog")).toHaveAttribute("data-provider", "e2e-apikey");
	await page.getByTestId("login-input").fill("e2e-onboarding-key");
	await page.getByTestId("login-submit").click();
}

async function hideModels(page: Page): Promise<{ hidden: boolean }> {
	const models = { hidden: false };
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			if (models.hidden && raw.includes('"method":"model.list"')) {
				const frame = JSON.parse(raw) as { id: string };
				ws.send(JSON.stringify({ id: frame.id, ok: true, result: [] }));
				return;
			}
			if (models.hidden && raw.includes('"method":"model.refresh"')) {
				const frame = JSON.parse(raw) as { id: string };
				ws.send(JSON.stringify({ id: frame.id, ok: true, result: { models: [], complete: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
	return models;
}

async function holdProviderStatus(
	page: Page,
): Promise<{ hold: boolean; held: () => number; release: () => void }> {
	const queued: string[] = [];
	let forward: (message: string) => void = () => {};
	const status = {
		hold: false,
		held: () => queued.length,
		release: () => {
			status.hold = false;
			for (const message of queued.splice(0)) forward(message);
		},
	};
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		forward = (message) => server.send(message);
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			if (status.hold && raw.includes('"method":"provider.status"')) {
				queued.push(raw);
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
	return status;
}

function signInOutsideThinkRail(providerId: string): void {
	const authPath = join(E2E_PI_AGENT_DIR, "auth.json");
	const stored = existsSync(authPath)
		? (JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>)
		: {};
	const credential = { type: "api_key", key: "e2e-outside-key" };
	writeFileSync(authPath, JSON.stringify({ ...stored, [providerId]: credential }), { mode: 0o600 });
}

test.afterEach(async ({ baseURL }) => {
	const cleanup = await Promise.allSettled([
		withWire(baseURL, signOutEveryProvider),
		setOnboardingDismissed(baseURL, true),
	]);
	removeTree(PROJECTS_PARENT);
	for (const step of cleanup) if (step.status === "rejected") throw step.reason;
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
	await expect(page.getByTestId("project-item").filter({ hasText: "Weather App" })).toBeVisible();
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
	await openColdStart(page, baseURL);

	const wizard = page.getByTestId("onboarding-wizard");
	await expect(wizard).toHaveAttribute("data-step", "intro");
	await expect(wizard.getByTestId("welcome-title")).toHaveText("ThinkRail");
	await expect(page.getByTestId("left-nav")).toHaveCount(0);
	await expect(wizard.getByTestId("connect-provider-options")).toHaveCount(0);
	await wizard.getByTestId("onboarding-start").click();
	await expect(wizard).toHaveAttribute("data-step", "connect");
	await expect(wizard.getByTestId("connect-provider-options")).toBeVisible();

	const list = wizard.getByTestId("connect-provider-list");
	const central = wizard
		.getByTestId("connect-detected-central")
		.or(list.getByTestId("jetbrains-ai-row"));
	await expect(central).toBeVisible();
	await expect(wizard.getByTestId("connect-detected")).toHaveCount(0);
	const rows = list.getByTestId("provider-signin-row");
	expect(await rows.count()).toBeGreaterThan(6);
	const anthropicRow = list.locator(
		'[data-testid="provider-signin-row"][data-provider="anthropic"]',
	);
	await expect(anthropicRow).toHaveCount(1);
	await expect(anthropicRow.getByTestId("provider-signin")).toHaveCount(1);
	await expect(anthropicRow.getByTestId("provider-apikey")).toHaveCount(1);
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
	await expect.poll(() => readConfig()?.onboardingDismissed).toBe(true);

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
		await openColdStart(page, baseURL);

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
		await openColdStart(page, baseURL);

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
				const config = readConfig();
				return [config?.analyticsEnabled, config?.analyticsConsentConfirmed];
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
	await setOnboardingDismissed(baseURL, false);
	await seedAnalyticsConsent(baseURL, false, false);
	try {
		await openColdStart(page, baseURL);

		const wizard = page.getByTestId("onboarding-wizard");
		await wizard.getByTestId("onboarding-start").click();
		await expect(wizard).toHaveAttribute("data-step", "privacy");
		const toggle = wizard.getByTestId("analytics-toggle");
		await expect.poll(() => readConfig()?.analyticsEnabled).toBe(true);
		const continueButton = wizard.getByTestId("onboarding-privacy-continue");
		await expect(continueButton).toBeEnabled();

		const original = readFileSync(CONFIG_PATH, "utf8");
		rmSync(CONFIG_PATH);
		mkdirSync(CONFIG_PATH);
		try {
			await toggle.click();
			await expect(wizard.getByRole("alert")).toBeVisible();
			await continueButton.click();
			await expect(wizard.getByRole("alert")).toBeVisible();
			await expect(wizard).toHaveAttribute("data-step", "privacy");
			await expect(toggle).toHaveAttribute("aria-checked", "false");
		} finally {
			rmSync(CONFIG_PATH, { recursive: true, force: true });
			writeFileSync(CONFIG_PATH, original);
		}
		expect(readConfig()?.analyticsEnabled).toBe(true);

		await continueButton.click();
		await expect(wizard).toHaveAttribute("data-step", "connect");
		expect([readConfig()?.analyticsEnabled, readConfig()?.analyticsConsentConfirmed]).toEqual([
			false,
			true,
		]);
	} finally {
		await seedAnalyticsConsent(baseURL, false, true);
	}
});

test("an opt-out confirmed elsewhere while the privacy step is open is adopted, not overwritten", async ({
	page,
	baseURL,
}) => {
	await setOnboardingDismissed(baseURL, false);
	await seedAnalyticsConsent(baseURL, false, false);
	try {
		await openColdStart(page, baseURL);

		const wizard = page.getByTestId("onboarding-wizard");
		await wizard.getByTestId("onboarding-start").click();
		await expect(wizard).toHaveAttribute("data-step", "privacy");
		const toggle = wizard.getByTestId("analytics-toggle");
		await expect(toggle).toHaveAttribute("aria-checked", "true");
		await expect.poll(() => readConfig()?.analyticsEnabled).toBe(true);

		await seedAnalyticsConsent(baseURL, false, true);
		await expect(toggle).toHaveAttribute("aria-checked", "false");
		await wizard.getByTestId("onboarding-privacy-continue").click();
		await expect(wizard).toHaveAttribute("data-step", "connect");
		expect([readConfig()?.analyticsEnabled, readConfig()?.analyticsConsentConfirmed]).toEqual([
			false,
			true,
		]);
	} finally {
		await seedAnalyticsConsent(baseURL, false, true);
	}
});

test("a provider connected through Settings during the intro is verified on reaching Connect", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	await openColdStart(page, baseURL);

	const wizard = page.getByTestId("onboarding-wizard");
	await expect(wizard).toHaveAttribute("data-step", "intro");
	await openProviders(page);
	await connectE2eKeyProvider(page, page.getByTestId("settings-providers"));
	await expect(page.getByTestId("login-success")).toBeVisible();
	await page.getByTestId("login-close").click();
	await expect(page.getByTestId("login-dialog")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toHaveCount(0);

	await wizard.getByTestId("onboarding-start").click();
	await expect(wizard).toHaveAttribute("data-step", "done");
	await expect(wizard.getByTestId("welcome-connected")).toContainText("E2E Key Provider connected");
});

test("a provider connected and signed out again through Settings during the intro is not verified", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	await openColdStart(page, baseURL);

	const wizard = page.getByTestId("onboarding-wizard");
	await openProviders(page);
	const settings = page.getByTestId("settings-providers");
	await connectE2eKeyProvider(page, settings);
	await page.getByTestId("login-close").click();
	await settings.locator('[data-testid="provider-signout"][data-provider="e2e-apikey"]').click();
	await expect(
		settings.locator('[data-testid="provider-row"][data-provider="e2e-apikey"]'),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toHaveCount(0);

	await wizard.getByTestId("onboarding-start").click();
	await expect(wizard).toHaveAttribute("data-step", "connect");
	await expect(
		wizard.locator('[data-testid="provider-signin-row"][data-provider="e2e-apikey"]'),
	).toBeVisible();
	await expect(wizard.getByTestId("onboarding-verify")).toHaveCount(0);
});

test("a provider signed out while its status re-read is still in flight is not verified", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	const status = await holdProviderStatus(page);
	await openColdStart(page, baseURL);

	const wizard = page.getByTestId("onboarding-wizard");
	await openProviders(page);
	const settings = page.getByTestId("settings-providers");
	await connectE2eKeyProvider(page, settings);
	await page.getByTestId("login-close").click();
	const signOut = settings.locator('[data-testid="provider-signout"][data-provider="e2e-apikey"]');
	await expect(signOut).toBeVisible();

	status.hold = true;
	await signOut.click();
	await expect.poll(status.held).toBeGreaterThan(0);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toHaveCount(0);
	await wizard.getByTestId("onboarding-start").click();
	await expect(wizard.getByTestId("connect-provider-options")).toBeVisible();
	status.release();

	await expect(
		wizard.locator('[data-testid="provider-signin-row"][data-provider="e2e-apikey"]'),
	).toBeVisible();
	await expect(wizard.getByTestId("onboarding-verify")).toHaveCount(0);
	await expect(wizard).toHaveAttribute("data-step", "connect");
});

test("the onboarding wizard verifies the connection in place, then collapses to one line over the two project cards", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	await openColdStart(page, baseURL);

	const wizard = page.getByTestId("onboarding-wizard");
	await wizard.getByTestId("onboarding-start").click();
	await connectE2eKeyProvider(page, wizard);
	await expect(page.getByTestId("login-dialog")).toHaveCount(0);

	await expect(wizard).toHaveAttribute("data-step", "done");
	await expect(wizard.getByTestId("welcome-title")).toHaveText("You're set");
	await expect(wizard.getByTestId("welcome-connected")).toHaveText(
		/^E2E Key Provider connected · (.+ is the default model|\d+ models? available)$/,
	);
	await expect(wizard.getByTestId("connect-provider-options")).toHaveCount(0);
	await expect(wizard.getByTestId("onboarding-skip")).toHaveCount(0);
	await expect(page.getByTestId("welcome-cta")).toContainText("Start a new project");
	await expect(page.getByTestId("welcome-action")).toHaveCount(1);
	await expect(page.getByTestId("welcome-action")).toContainText("Open project");
	await expect.poll(() => readConfig()?.onboardingDismissed).toBe(true);

	await page.getByTestId("welcome-cta").click();
	const dialog = page.getByTestId("create-project-dialog");
	await dialog.getByTestId("create-project-name").fill("wizard-app");
	await dialog.getByTestId("create-project-submit").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toHaveValue(SETUP_PROMPT);
	await expect(page.getByTestId("new-workspace-dialog")).toHaveCount(0);
});

test("a connection with zero models warns, and Check again verifies it once models appear", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	const models = await hideModels(page);
	await openColdStart(page, baseURL);

	const wizard = page.getByTestId("onboarding-wizard");
	await wizard.getByTestId("onboarding-start").click();
	models.hidden = true;
	await connectE2eKeyProvider(page, wizard);
	const verify = wizard.getByTestId("onboarding-verify");
	await expect(verify).toHaveAttribute("data-state", "warning");
	await expect(verify.getByTestId("onboarding-no-models")).toContainText("E2E Key Provider");
	await expect(wizard).toHaveAttribute("data-step", "connect");

	models.hidden = false;
	await verify.getByTestId("onboarding-recheck").click();
	await expect(wizard).toHaveAttribute("data-step", "done");
	await expect(wizard.getByTestId("welcome-connected")).toContainText("E2E Key Provider connected");
});

test("Back from a zero-model connection returns to the choices", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await setOnboardingDismissed(baseURL, false);
	const models = await hideModels(page);
	await openColdStart(page, baseURL);

	const wizard = page.getByTestId("onboarding-wizard");
	await wizard.getByTestId("onboarding-start").click();
	models.hidden = true;
	await connectE2eKeyProvider(page, wizard);
	await expect(wizard.getByTestId("onboarding-verify")).toHaveAttribute("data-state", "warning");
	await wizard.getByTestId("onboarding-back").click();
	await expect(wizard.getByTestId("onboarding-verify")).toHaveCount(0);
	await expect(wizard.getByTestId("connect-provider-options")).toBeVisible();
	await expect(wizard).toHaveAttribute("data-step", "connect");
});

test("connecting from the Welcome banner closes the stack, toasts once, and hands off", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await openColdStart(page, baseURL);
	const banner = page.getByTestId("welcome-provider-warning");

	await page.getByTestId("welcome-connect-provider").click();
	const dialog = page.getByTestId("connect-provider-dialog");
	await connectE2eKeyProvider(page, dialog);

	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("login-dialog")).toHaveCount(0);
	const toast = page.getByTestId("toast").filter({ hasText: "E2E Key Provider connected" });
	await expect(toast).toBeVisible();
	await expect(toast).toHaveCount(1);
	await expect(page.getByTestId("welcome-title")).toHaveText("You're set");
	await expect(page.getByTestId("welcome-connected")).toContainText("E2E Key Provider connected");
	await expect(banner).toHaveCount(0);
});

test("the banner's connect dialog still hands off when its opening status re-read lands after the sign-in", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	const status = await holdProviderStatus(page);
	await openColdStart(page, baseURL);
	await expect(page.getByTestId("welcome-provider-warning")).toBeVisible();

	status.hold = true;
	await page.getByTestId("welcome-connect-provider").click();
	const dialog = page.getByTestId("connect-provider-dialog");
	await expect.poll(status.held).toBeGreaterThan(0);
	const opening = status.held();
	await connectE2eKeyProvider(page, dialog);
	await expect(page.getByTestId("login-success")).toBeVisible();
	await expect.poll(status.held).toBeGreaterThan(opening);
	status.release();

	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByTestId("toast").filter({ hasText: "E2E Key Provider connected" }),
	).toBeVisible();
});

test("Welcome re-reads provider status when it opens again, so a sign-in made outside ThinkRail shows", {
	tag: "@dev-seam",
}, async ({ page, baseURL }) => {
	await openColdStart(page, baseURL);
	const banner = page.getByTestId("welcome-provider-warning");
	await expect(banner).toBeVisible();

	await page.getByTestId("welcome-cta").filter({ hasText: "Start a new project" }).click();
	const dialog = page.getByTestId("create-project-dialog");
	await dialog.getByTestId("create-project-name").fill("outside-sign-in");
	await dialog.getByTestId("create-project-submit").click();
	await expect(page.getByTestId("chat-input")).toHaveValue(SETUP_PROMPT);

	signInOutsideThinkRail("e2e-apikey");
	await page.getByTestId("project-item").first().getByText("outside-sign-in").click();
	await expect(page.getByTestId("welcome-title")).toHaveText("outside-sign-in");
	await expect(banner).toHaveCount(0);
});

test("a sign-in abandoned by a reload does not park the next attempt on Working…", async ({
	page,
	baseURL,
}) => {
	await openColdStart(page, baseURL);

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
