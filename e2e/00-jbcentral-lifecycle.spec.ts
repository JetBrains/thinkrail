import { existsSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { openAppFresh, openFixtureProject } from "./fixtures/app";
import {
	assertOnlyReviewedArgv,
	centralInvocationCount,
	connectCentral,
	openProviders,
	reprobeCentralStatus,
	runCentralOnHost,
	setCentralInstalled,
	waitForCentralState,
	waitForVersionProbe,
} from "./fixtures/jbcentral";
import { E2E_CENTRAL_ARTIFACT, E2E_CENTRAL_STATE } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";

test.use({ deviceScaleFactor: 2 });

const GROUP = "jbcentral";

const CENTRAL_MODEL = '[data-testid="model-option"][data-model-id="e2e-central-model"]';

function signedOutNotice(page: Page) {
	return page.getByTestId("jetbrains-signed-out");
}

async function centralModelsOfferedToNewChats(page: Page): Promise<number> {
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("model-selector").click();
	const count = await page.locator(CENTRAL_MODEL).count();
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	return count;
}

test("Central is not installed: the card asks for the host install, and Recheck picks it up", async ({
	page,
}) => {
	await openAppFresh(page);
	setCentralInstalled(false);
	try {
		const card = await openProviders(page);
		await waitForCentralState(page, "absent");

		const guidance = page.getByTestId("jetbrains-needs-install");
		await expect(guidance).toBeVisible();
		await expect(guidance).toContainText("central-cli.labs.jb.gg");
		await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
		await card.scrollIntoViewIfNeeded();
		await shot(page.getByTestId("settings-dialog"), GROUP, "00-providers-panel");
		await shot(card, GROUP, "01-not-installed");
	} finally {
		setCentralInstalled(true);
	}

	await page.getByTestId("jetbrains-recheck").click();
	const card = await waitForCentralState(page, "supported");
	await expect(page.getByTestId("jetbrains-ready")).toBeVisible();
	await shot(card, GROUP, "02-installed-and-ready");
	assertOnlyReviewedArgv();
});

test("Central is installed but signed out: the card offers Sign in, never Connect", async ({
	page,
}) => {
	await openAppFresh(page);
	writeFileSync(E2E_CENTRAL_STATE, "needs-login");
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");
	await reprobeCentralStatus(page);

	await expect(signedOutNotice(page)).toBeVisible({ timeout: 15_000 });
	await expect(signedOutNotice(page)).toContainText("Central is signed out");
	await expect(page.getByTestId("jetbrains-ready")).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(1);
	await expect(card.getByTestId("jetbrains-copy-cmd")).toHaveCount(0);
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	await shot(card, GROUP, "03-signed-out-offers-signin");

	await page.getByTestId("jetbrains-signin").click();
	await expect(page.getByTestId("jetbrains-login-launched")).toBeVisible();
	await shot(card, GROUP, "04-signin-launched");

	const connect = page.getByTestId("jetbrains-connect");
	await expect(connect).toBeVisible({ timeout: 15_000 });
	await expect(signedOutNotice(page)).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-login-launched")).toHaveCount(0);
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible();
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);
	await shot(card, GROUP, "05-connected");
	assertOnlyReviewedArgv();
});

test("a configured stopped proxy offers Start proxy and returns to Connected", async ({ page }) => {
	await openAppFresh(page);
	writeFileSync(E2E_CENTRAL_STATE, "proxy-stopped");
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await reprobeCentralStatus(page);

	await expect(page.getByTestId("jetbrains-proxy-stopped")).toContainText(
		"Central's proxy is not running",
	);
	await expect(page.getByTestId("jetbrains-start-proxy")).toHaveCount(1);
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-disconnect")).toHaveCount(0);
	await expect(card).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	await shot(card, GROUP, "06-proxy-stopped");

	await page.getByTestId("jetbrains-start-proxy").click();
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("jetbrains-disconnect")).toBeVisible();
	expect(centralInvocationCount("proxy start --ensure-updated")).toBe(1);
	await shot(card, GROUP, "06-proxy-started");

	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
});

test("a sign-in launch that dies falls back to the command to run on the host", async ({
	page,
}) => {
	await openAppFresh(page);
	writeFileSync(E2E_CENTRAL_STATE, "needs-login login-error");
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");
	await reprobeCentralStatus(page);
	await expect(signedOutNotice(page)).toBeVisible({ timeout: 15_000 });

	await page.getByTestId("jetbrains-signin").click();
	const failed = page.getByTestId("jetbrains-login-failed");
	await expect(failed).toBeVisible({ timeout: 30_000 });
	await expect(failed).toContainText("couldn't launch Central sign-in");
	await expect(failed.getByTestId("jetbrains-copy-cmd")).toHaveCount(1);
	await expect(page.getByTestId("jetbrains-login-launched")).toHaveCount(0);
	await shot(card, GROUP, "13-signin-launch-failed");
	assertOnlyReviewedArgv();
});

test("a Connect failure that reveals a signed-out host still offers sign-in exactly once", async ({
	page,
}) => {
	await openAppFresh(page);
	writeFileSync(E2E_CENTRAL_STATE, "add-error");
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await expect(page.getByTestId("jetbrains-error")).toBeVisible();
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(1);

	writeFileSync(E2E_CENTRAL_STATE, "add-error needs-login");
	await reprobeCentralStatus(page);
	await expect(signedOutNotice(page)).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(1);
	await expect(page.getByTestId("jetbrains-signin-guidance")).toHaveCount(0);
	await shot(card, GROUP, "14-failure-plus-signed-out");
	assertOnlyReviewedArgv();
});

test("Central is uninstalled while connected: models are withdrawn, the artifact survives, reinstall repairs", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");

	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	expect(await centralModelsOfferedToNewChats(page)).toBe(1);

	setCentralInstalled(false);
	try {
		const card = await openProviders(page);
		await page.getByTestId("providers-refresh").click();
		await waitForCentralState(page, "absent");
		await expect(page.getByTestId("jetbrains-needs-install")).toBeVisible();
		expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);
		await shot(card, GROUP, "07-uninstalled-while-connected");

		await page.keyboard.press("Escape");
		await expect(page.getByTestId("settings-dialog")).toBeHidden();
		expect(await centralModelsOfferedToNewChats(page)).toBe(0);
	} finally {
		setCentralInstalled(true);
	}

	const card = await openProviders(page);
	await waitForCentralState(page, "configured");
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible();
	expect(centralInvocationCount("add pi")).toBe(1);
	await shot(card, GROUP, "08-reinstalled-repairs");

	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	expect(await centralModelsOfferedToNewChats(page)).toBe(1);
	assertOnlyReviewedArgv();
});

test("PI is disconnected: in-app Disconnect and `central remove pi` on the host both land on ready", async ({
	page,
}) => {
	await openAppFresh(page);
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");

	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	await expect(page.getByTestId("jetbrains-ready")).toBeVisible();
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(false);
	expect(centralInvocationCount("remove pi")).toBe(1);
	await shot(card, GROUP, "09-disconnected-in-app");

	await connectCentral(page);
	await waitForCentralState(page, "configured");

	runCentralOnHost("remove", "pi");
	await waitForCentralState(page, "supported");
	await expect(page.getByTestId("jetbrains-connect")).toBeVisible();
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(false);
	expect(centralInvocationCount("remove pi")).toBe(2);
	await shot(card, GROUP, "10-pi-removed-on-host");
	assertOnlyReviewedArgv();
});

test("the user logs out of Central while connected: the card keeps the connection and warns", async ({
	page,
}) => {
	await openAppFresh(page);
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");

	const probes = centralInvocationCount("--version");
	writeFileSync(E2E_CENTRAL_STATE, "needs-login");
	await reprobeCentralStatus(page);
	await waitForVersionProbe(probes);
	await expect(card).toHaveAttribute("data-state", "configured");
	await expect(signedOutNotice(page)).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("jetbrains-connected")).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(1);
	await expect(page.getByTestId("jetbrains-disconnect")).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
	await shot(card, GROUP, "11-logged-out-while-connected");

	await page.getByTestId("jetbrains-signin").click();
	await expect(page.getByTestId("jetbrains-disconnect")).toBeVisible({ timeout: 15_000 });
	await expect(signedOutNotice(page)).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible();
	await expect(page.getByTestId("jetbrains-login-launched")).toHaveCount(0);
	await expect(card).toHaveAttribute("data-state", "configured");
	await shot(card, GROUP, "12-signed-in-again");

	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
});
