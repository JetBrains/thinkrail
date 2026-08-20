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

/**
 * The JetBrains AI card's lifecycle from the *user's* side: the states someone actually lands in when
 * Central is missing, signed out, uninstalled under a live connection, disconnected, or logged out.
 * Every state is captured as a review screenshot (`e2e/screenshots/jbcentral/`) alongside its assertions.
 */

// Retina shots: the card's copy is the artifact under review here, so it has to be readable.
test.use({ deviceScaleFactor: 2 });

const GROUP = "jbcentral";

const CENTRAL_MODEL = '[data-testid="model-option"][data-model-id="e2e-central-model"]';

/** The standing signed-out warning (with its sign-in button) — distinct from a failure's own guidance. */
function signedOutNotice(page: Page) {
	return page.getByTestId("jetbrains-signed-out");
}

/** Count the Central models a *new* chat would be offered, via the New-Workspace dialog's picker. */
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
		// The command is the host's, not the browser's — a phone on Tailscale must still get the host's OS.
		await expect(guidance).toContainText("central-cli.labs.jb.gg");
		await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
		// Context shot: the card sits below the provider list, so scroll it into frame first.
		await card.scrollIntoViewIfNeeded();
		await shot(page.getByTestId("settings-dialog"), GROUP, "00-providers-panel");
		await shot(card, GROUP, "01-not-installed");
	} finally {
		setCentralInstalled(true);
	}

	// Installing Central is out-of-band — nothing watches PATH, so Recheck is the affordance that finds it.
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

	// Signed out is stated, not implied: the "Central is ready" claim is replaced, not annotated.
	await expect(signedOutNotice(page)).toBeVisible({ timeout: 15_000 });
	await expect(signedOutNotice(page)).toContainText("Central is signed out");
	await expect(page.getByTestId("jetbrains-ready")).toHaveCount(0);
	// Connect is withheld entirely — it cannot succeed without credentials, so it is not advertised.
	await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
	// One affordance: the sign-in button, with no `central login` command beside it.
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(1);
	await expect(card.getByTestId("jetbrains-copy-cmd")).toHaveCount(0);
	// Central's status output never reaches the UI — only the verdict does.
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	await shot(card, GROUP, "03-signed-out-offers-signin");

	await page.getByTestId("jetbrains-signin").click();
	await expect(page.getByTestId("jetbrains-login-launched")).toBeVisible();
	await shot(card, GROUP, "04-signin-launched");

	// Signing in completed on the host (the fake clears its signed-out control), so Connect becomes the
	// action — the launch invalidated the verdict, and the card re-read on its own.
	const connect = page.getByTestId("jetbrains-connect");
	await expect(connect).toBeVisible({ timeout: 15_000 });
	await expect(signedOutNotice(page)).toHaveCount(0);
	// The "finish it in the browser" note dies with the demand it described — and here the lifecycle state
	// never reaches `configured`, so only the demand clearing can retire it.
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

/**
 * The sign-in launch that dies on arrival. The real `central login` drives its browser handoff from a
 * terminal UI and exits immediately when it has none, so "we spawned it" is not evidence it started — and
 * claiming otherwise sends the user to watch a browser that never opened. When the launch fails, the command
 * to run on the host is the fallback, and it is the ONLY place that command appears.
 */
test("a sign-in launch that dies falls back to the command to run on the host", async ({
	page,
}) => {
	await openAppFresh(page);
	// Two independent facts at once: no credentials, and a login that refuses to start.
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
	// The optimistic "now finish it in your browser" note must NOT appear — nothing was launched.
	await expect(page.getByTestId("jetbrains-login-launched")).toHaveCount(0);
	await shot(card, GROUP, "13-signin-launch-failed");
	assertOnlyReviewedArgv();
});

/**
 * A Connect failure and a signed-out verdict arriving together. This combination is reachable precisely
 * *because* a refused `add pi` invalidates the auth cache: the failure renders its own sign-in guidance while
 * the fresh verdict puts Sign in in the header. Exactly one sign-in affordance may survive — the header's,
 * since it is the settled state's own action — or the card asks the same question twice.
 */
test("a Connect failure that reveals a signed-out host still offers sign-in exactly once", async ({
	page,
}) => {
	await openAppFresh(page);
	// Signed in, but `add pi` refuses — so Connect is offered and then fails.
	writeFileSync(E2E_CENTRAL_STATE, "add-error");
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await expect(page.getByTestId("jetbrains-error")).toBeVisible();
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(1);

	// The host turns out to hold no credentials after all; the refused action already dropped the verdict.
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

	// The user removes the CLI. Uninstalling Central does NOT remove the global PI extension it wrote.
	setCentralInstalled(false);
	try {
		const card = await openProviders(page);
		await page.getByTestId("providers-refresh").click();
		await waitForCentralState(page, "absent");
		await expect(page.getByTestId("jetbrains-needs-install")).toBeVisible();
		expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);
		await shot(card, GROUP, "07-uninstalled-while-connected");

		// An unverifiable Central is not loaded: the runtime for new work drops it even though the file is there.
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("settings-dialog")).toBeHidden();
		expect(await centralModelsOfferedToNewChats(page)).toBe(0);
	} finally {
		setCentralInstalled(true);
	}

	// Reopening Providers re-reads status, so the reinstall is picked up without an explicit Recheck.
	const card = await openProviders(page);
	await waitForCentralState(page, "configured");
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible();
	// Repair is a re-probe, not a re-configure: the surviving artifact means no second `central add pi`.
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

	// Same removal, done by the user in their own shell: the artifact watcher settles the open card with no
	// Refresh click, and ThinkRail does not re-run a removal that already happened.
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

	// `central logout` on the host. The artifact is untouched, so the lifecycle state stays `configured` —
	// but the combined status probe notices, and the card warns that models will now fail.
	const probes = centralInvocationCount("--version");
	writeFileSync(E2E_CENTRAL_STATE, "needs-login");
	await reprobeCentralStatus(page);
	await waitForVersionProbe(probes);
	// The lifecycle state is untouched — but the card reports the signed-out fact alone, not beside a
	// "Connected" line that would contradict it.
	await expect(card).toHaveAttribute("data-state", "configured");
	await expect(signedOutNotice(page)).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("jetbrains-connected")).toHaveCount(0);
	// Sign in is the *only* action offered: Disconnect is withheld too, so the card asks for the one thing
	// that resolves the state instead of presenting an unrelated choice beside it.
	await expect(page.getByTestId("jetbrains-signin")).toHaveCount(1);
	await expect(page.getByTestId("jetbrains-disconnect")).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-connect")).toHaveCount(0);
	await shot(card, GROUP, "11-logged-out-while-connected");

	// Signing back in resolves it, and the ordinary actions return with the credentials.
	await page.getByTestId("jetbrains-signin").click();
	await expect(page.getByTestId("jetbrains-disconnect")).toBeVisible({ timeout: 15_000 });
	await expect(signedOutNotice(page)).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible();
	// The "finish it in the browser" note died with the demand it described, rather than sitting under a
	// Connected line telling the user to go do something already done.
	await expect(page.getByTestId("jetbrains-login-launched")).toHaveCount(0);
	await expect(card).toHaveAttribute("data-state", "configured");
	await shot(card, GROUP, "12-signed-in-again");

	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
});
