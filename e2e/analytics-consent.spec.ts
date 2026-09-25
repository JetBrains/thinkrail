import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
	ANALYTICS_CONSENT_PROTOCOL_VERSION,
	type AppConfig,
	type AppConfigUpdate,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { seedAnalyticsConsent } from "./fixtures/analyticsConsent";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";

const configPath = join(E2E_DATA_DIR, "config.json");
const ANALYTICS_COPY =
	"Share anonymous product usage and how you found ThinkRail. We never collect prompts, code, files, credentials, or account identity.";

function savedConfig(): AppConfig {
	return JSON.parse(readFileSync(configPath, "utf8")) as AppConfig;
}

function trackSettingsUpdates(page: Page): AppConfigUpdate[] {
	const updates: AppConfigUpdate[] = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			const request = JSON.parse(String(payload)) as {
				method?: string;
				params?: { config?: AppConfigUpdate };
			};
			if (request.method === "settings.update" && request.params?.config) {
				updates.push(request.params.config);
			}
		});
	});
	return updates;
}

async function openPrivacy(page: Page, legacy = false): Promise<void> {
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-privacy").click();
	await expect(page.getByTestId("settings-privacy")).toBeVisible();
	if (!legacy) await expect(page.getByTestId("settings-privacy")).toContainText(ANALYTICS_COPY);
}

async function waitForPrime(updates: AppConfigUpdate[]): Promise<void> {
	await expect.poll(() => updates).toEqual([{ analyticsEnabled: true }]);
	await expect
		.poll(() => savedConfig())
		.toMatchObject({
			analyticsEnabled: true,
			analyticsConsentConfirmed: false,
		});
}

test.afterEach(async ({ baseURL }) => {
	await seedAnalyticsConsent(baseURL, false, true);
});

for (const enabled of [true, false]) {
	test(`first dialog primes on from saved ${enabled ? "on" : "off"} and Done confirms on`, async ({
		page,
		baseURL,
	}) => {
		await seedAnalyticsConsent(baseURL, enabled, false);
		const updates = trackSettingsUpdates(page);
		await page.goto("/");
		const dialog = page.getByTestId("analytics-consent-dialog");
		const toggle = dialog.getByRole("switch", { name: "Share additional usage data" });
		await expect(dialog).toBeVisible();
		await expect(toggle).toBeChecked();
		await expect(dialog.getByRole("heading")).toHaveText("Help improve ThinkRail");
		await expect(dialog).toContainText(ANALYTICS_COPY);
		await expect(dialog.getByRole("button")).toHaveCount(2);
		await expect(dialog.getByTestId("analytics-consent-confirm")).toHaveText("Done");
		await waitForPrime(updates);
		await shot(dialog, "analytics-consent", enabled ? "saved-on" : "saved-off");

		await dialog.getByTestId("analytics-consent-confirm").click();
		await expect(dialog).toBeHidden();
		expect(updates).toEqual([
			{ analyticsEnabled: true },
			{ analyticsEnabled: true, analyticsConsentConfirmed: true },
		]);
		expect(savedConfig()).toMatchObject({
			analyticsEnabled: true,
			analyticsConsentConfirmed: true,
		});
		await page.reload();
		await openPrivacy(page);
		await expect(dialog).toBeHidden();
		await expect(page.getByTestId("analytics-toggle")).toBeChecked();
	});
}

for (const dismissal of ["close", "escape", "backdrop"] as const) {
	test(`first-dialog ${dismissal} accepts the primed on choice`, async ({ page, baseURL }) => {
		await seedAnalyticsConsent(baseURL, false, false);
		const updates = trackSettingsUpdates(page);
		await page.goto("/");
		const dialog = page.getByTestId("analytics-consent-dialog");
		await expect(dialog).toBeVisible();
		await waitForPrime(updates);
		if (dismissal === "close") await dialog.getByRole("button", { name: "Close" }).click();
		else if (dismissal === "escape") await page.keyboard.press("Escape");
		else await page.getByTestId("dialog-overlay").click({ position: { x: 4, y: 4 } });
		await expect(dialog).toBeHidden();
		expect(updates).toEqual([
			{ analyticsEnabled: true },
			{ analyticsEnabled: true, analyticsConsentConfirmed: true },
		]);
		expect(savedConfig()).toMatchObject({
			analyticsEnabled: true,
			analyticsConsentConfirmed: true,
		});
	});
}

test("switching off immediately persists refusal and closes from the broadcast", async ({
	page,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, false, false);
	const updates = trackSettingsUpdates(page);
	await page.goto("/");
	const dialog = page.getByTestId("analytics-consent-dialog");
	const toggle = dialog.getByTestId("analytics-toggle");
	await expect(dialog).toBeVisible();
	await waitForPrime(updates);
	await toggle.click();
	await expect(dialog).toBeHidden();
	expect(updates).toEqual([
		{ analyticsEnabled: true },
		{ analyticsEnabled: false, analyticsConsentConfirmed: true },
	]);
	expect(savedConfig()).toMatchObject({
		analyticsEnabled: false,
		analyticsConsentConfirmed: true,
	});
});

for (const action of ["done", "close"] as const) {
	test(`failed ${action} persistence keeps the on choice visible and retryable`, async ({
		page,
		baseURL,
	}) => {
		await seedAnalyticsConsent(baseURL, false, false);
		const updates = trackSettingsUpdates(page);
		await page.goto("/");
		const dialog = page.getByTestId("analytics-consent-dialog");
		await expect(dialog).toBeVisible();
		await waitForPrime(updates);
		const original = readFileSync(configPath, "utf8");
		rmSync(configPath);
		mkdirSync(configPath);
		const actionControl =
			action === "done"
				? dialog.getByTestId("analytics-consent-confirm")
				: dialog.getByRole("button", { name: "Close" });
		try {
			await actionControl.click();
			await expect(dialog.getByRole("alert")).toContainText("Couldn't save your choice");
			await expect(dialog.getByRole("switch")).toBeChecked();
			await expect(actionControl).toBeEnabled();
		} finally {
			rmSync(configPath, { recursive: true, force: true });
			writeFileSync(configPath, original);
		}
		await actionControl.click();
		await expect(dialog).toBeHidden();
		expect(savedConfig()).toMatchObject({
			analyticsEnabled: true,
			analyticsConsentConfirmed: true,
		});
	});
}

test("failed immediate refusal stays off and Done retries it", async ({ page, baseURL }) => {
	await seedAnalyticsConsent(baseURL, false, false);
	const updates = trackSettingsUpdates(page);
	await page.goto("/");
	const dialog = page.getByTestId("analytics-consent-dialog");
	await expect(dialog).toBeVisible();
	await waitForPrime(updates);
	const original = readFileSync(configPath, "utf8");
	rmSync(configPath);
	mkdirSync(configPath);
	try {
		await dialog.getByTestId("analytics-toggle").click();
		await expect(dialog.getByRole("alert")).toContainText("Couldn't save your choice");
		await expect(dialog.getByTestId("analytics-toggle")).not.toBeChecked();
	} finally {
		rmSync(configPath, { recursive: true, force: true });
		writeFileSync(configPath, original);
	}
	await dialog.getByTestId("analytics-consent-confirm").click();
	await expect(dialog).toBeHidden();
	expect(savedConfig()).toMatchObject({
		analyticsEnabled: false,
		analyticsConsentConfirmed: true,
	});
});

test("failed priming remains visible and Done can persist the on choice", async ({
	page,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, false, false);
	const original = readFileSync(configPath, "utf8");
	rmSync(configPath);
	mkdirSync(configPath);
	try {
		await page.goto("/");
		const dialog = page.getByTestId("analytics-consent-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("alert")).toContainText("Couldn't save your choice");
		await expect(dialog.getByTestId("analytics-toggle")).toBeChecked();
	} finally {
		rmSync(configPath, { recursive: true, force: true });
		writeFileSync(configPath, original);
	}
	await page.getByTestId("analytics-consent-confirm").click();
	await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();
	expect(savedConfig()).toMatchObject({
		analyticsEnabled: true,
		analyticsConsentConfirmed: true,
	});
});

test("confirmation closes a peer draft and later Settings changes converge across clients", async ({
	page,
	context,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, false, false);
	const updates = trackSettingsUpdates(page);
	await page.goto("/");
	await waitForPrime(updates);
	const peer = await context.newPage();
	try {
		const peerUpdates = trackSettingsUpdates(peer);
		await peer.goto("/");
		await expect(peer.getByTestId("analytics-consent-dialog")).toBeVisible();
		await waitForPrime(peerUpdates);
		await page.getByTestId("analytics-consent-confirm").click();
		await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();
		await expect(peer.getByTestId("analytics-consent-dialog")).toBeHidden();
		await openPrivacy(page);
		await openPrivacy(peer);
		await expect(peer.getByTestId("analytics-toggle")).toBeChecked();
		await page.getByTestId("analytics-toggle").click();
		await expect(peer.getByTestId("analytics-toggle")).not.toBeChecked();
		await peer.getByTestId("analytics-toggle").click();
		await expect(page.getByTestId("analytics-toggle")).toBeChecked();
		expect(updates).toEqual([
			{ analyticsEnabled: true },
			{ analyticsEnabled: true, analyticsConsentConfirmed: true },
			{ analyticsEnabled: false, analyticsConsentConfirmed: true },
		]);
		expect(peerUpdates).toEqual([
			{ analyticsEnabled: true },
			{ analyticsEnabled: true, analyticsConsentConfirmed: true },
		]);
	} finally {
		await peer.close();
	}
});

for (const enabled of [true, false]) {
	test(`confirmed ${enabled ? "on" : "off"} never opens or primes`, async ({ page, baseURL }) => {
		await seedAnalyticsConsent(baseURL, enabled, true);
		const updates = trackSettingsUpdates(page);
		await page.goto("/");
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();
		expect(updates).toEqual([]);
		expect(savedConfig()).toMatchObject({
			analyticsEnabled: enabled,
			analyticsConsentConfirmed: true,
		});
	});
}

test("consent takes precedence over an addressed interview invitation", async ({
	page,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, false, false);
	let browserSocket: WebSocketRoute | undefined;
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		browserSocket = socket;
		socket.connectToServer();
	});
	await page.goto("/");
	await expect(page.getByTestId("analytics-consent-dialog")).toBeVisible();
	if (!browserSocket) throw new Error("Expected the app WebSocket");
	browserSocket.send(JSON.stringify({ channel: WS_CHANNELS.feedbackInterview, data: {} }));
	await expect(page.getByTestId("interview-prompt-dialog")).toBeHidden();
	await page.getByTestId("analytics-consent-confirm").click();
	await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();
	await expect(page.getByTestId("interview-prompt-dialog")).toBeVisible();
});

test("pre-v65 hosts keep the legacy Privacy switch without a consent dialog or confirmation writes", async ({
	page,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, true, false);
	const updates = trackSettingsUpdates(page);
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		server.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				channel?: string;
				data: { protocolVersion: number; config: Partial<AppConfig> };
			};
			if (frame.channel === WS_CHANNELS.serverWelcome) {
				frame.data.protocolVersion = ANALYTICS_CONSENT_PROTOCOL_VERSION - 1;
				delete frame.data.config.analyticsConsentConfirmed;
				socket.send(JSON.stringify(frame));
			} else socket.send(message);
		});
	});
	await page.goto("/");
	await openPrivacy(page, true);
	await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();
	const toggle = page.getByRole("switch", { name: "Share anonymous usage analytics" });
	await expect(toggle).toBeChecked();
	await toggle.click();
	await expect(toggle).not.toBeChecked();
	expect(updates).toEqual([{ analyticsEnabled: false }]);
	expect(savedConfig()).toMatchObject({
		analyticsEnabled: false,
		analyticsConsentConfirmed: false,
	});
});
