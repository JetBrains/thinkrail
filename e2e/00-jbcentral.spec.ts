import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openAppFresh, openFixtureProject } from "./fixtures/app";
import {
	E2E_CENTRAL_ARTIFACT,
	E2E_CENTRAL_LOG,
	E2E_CENTRAL_STATE,
	E2E_FAKE_BIN_DIR,
	E2E_PI_AGENT_DIR,
} from "./fixtures/paths";

async function openProviders(page: Page) {
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();
	return page.getByTestId("jetbrains-ai-card");
}

async function waitForCentralState(page: Page, state: string) {
	const card = page.getByTestId("jetbrains-ai-card");
	await expect(card).toHaveAttribute("data-state", state, { timeout: 15_000 });
	return card;
}

function centralInvocations(): string[] {
	if (!existsSync(E2E_CENTRAL_LOG)) return [];
	return readFileSync(E2E_CENTRAL_LOG, "utf8").trim().split("\n").filter(Boolean);
}

function assertOnlyReviewedArgv(): void {
	for (const invocation of centralInvocations()) {
		expect(["--version", "add pi", "remove pi", "login", "update --install"]).toContain(invocation);
	}
}

/** Native global configuration: no standalone pi executable and no proxy/model reconstruction. */
test("connects, reconciles external artifact drift, and disconnects through the native Central surface", async ({
	page,
}) => {
	await openAppFresh(page);
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");

	await page.getByTestId("jetbrains-connect").click();
	await waitForCentralState(page, "configured");
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible();
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);
	expect(existsSync(join(E2E_PI_AGENT_DIR, "extensions", "jetbrains-central.ts"))).toBe(false);
	await expect(page.getByTestId("settings-dialog")).not.toContainText(
		"E2E_PROVIDER_SECRET_SENTINEL",
	);
	await expect(page.getByTestId("settings-dialog")).not.toContainText(
		"E2E_PROVIDER_CONFIG_SENTINEL",
	);

	// An out-of-band global removal uses the same serialized runtime-generation path. Refresh may observe
	// pending first; the card polls until the host-authoritative supported state lands.
	rmSync(E2E_CENTRAL_ARTIFACT, { force: true });
	await page.getByTestId("providers-refresh").click();
	await waitForCentralState(page, "supported");
	await expect(page.getByTestId("jetbrains-connect")).toBeVisible();

	await page.getByTestId("jetbrains-connect").click();
	await waitForCentralState(page, "configured");
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(false);

	assertOnlyReviewedArgv();
	expect(centralInvocations()).toContain("add pi");
	expect(centralInvocations()).toContain("remove pi");
	await expect(card).toHaveAttribute("data-configured", "false");
});

test("guides absent, outdated, unreviewed, malformed, and failed Central version states", async ({
	page,
}) => {
	await openAppFresh(page);
	const central = join(E2E_FAKE_BIN_DIR, "central");
	const hidden = join(E2E_FAKE_BIN_DIR, "central.hidden");
	renameSync(central, hidden);
	try {
		await openProviders(page);
		await waitForCentralState(page, "absent");
		await expect(page.getByTestId("jetbrains-needs-install")).toBeVisible();
	} finally {
		renameSync(hidden, central);
	}

	await page.getByTestId("jetbrains-recheck").click();
	await waitForCentralState(page, "supported");

	writeFileSync(E2E_CENTRAL_STATE, "outdated");
	await page.getByTestId("providers-refresh").click();
	await waitForCentralState(page, "outdated");
	await expect(page.getByTestId("jetbrains-outdated")).toContainText("1.5.0");
	await page.getByTestId("jetbrains-update").click();
	await waitForCentralState(page, "supported");

	writeFileSync(E2E_CENTRAL_STATE, "unreviewed");
	await page.getByTestId("providers-refresh").click();
	await waitForCentralState(page, "unreviewed");
	await expect(page.getByTestId("jetbrains-unreviewed")).toContainText("1.7.0");

	writeFileSync(E2E_CENTRAL_STATE, "malformed");
	await page.getByTestId("providers-refresh").click();
	await waitForCentralState(page, "malformed-version");
	await expect(page.getByTestId("jetbrains-version-error")).not.toContainText(
		"synthetic malformed",
	);

	writeFileSync(E2E_CENTRAL_STATE, "probe-error");
	await page.getByTestId("providers-refresh").click();
	await waitForCentralState(page, "probe-failed");
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	assertOnlyReviewedArgv();
});

test("guides Central sign-in and retries without exposing child output", async ({ page }) => {
	await openAppFresh(page);
	writeFileSync(E2E_CENTRAL_STATE, "needs-login");
	await openProviders(page);
	await waitForCentralState(page, "supported");

	await page.getByTestId("jetbrains-connect").click();
	await expect(page.getByTestId("jetbrains-signin-guidance")).toBeVisible();
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	await page.getByTestId("jetbrains-signin").click();
	await expect(page.getByTestId("jetbrains-login-launched")).toBeVisible();
	await expect.poll(() => readFileSync(E2E_CENTRAL_STATE, "utf8")).toBe("");

	await page.getByTestId("jetbrains-connect").click();
	await waitForCentralState(page, "configured");
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
	expect(centralInvocations()).toContain("login");
});

test("surfaces missing-artifact and candidate failures as closed UI states, then repairs", async ({
	page,
}) => {
	await openAppFresh(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");

	writeFileSync(E2E_CENTRAL_STATE, "missing-artifact");
	await page.getByTestId("jetbrains-connect").click();
	await expect(page.getByTestId("jetbrains-error")).toContainText("couldn't confirm");
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");

	writeFileSync(E2E_CENTRAL_STATE, "candidate-error");
	await page.getByTestId("jetbrains-connect").click();
	await expect.poll(() => existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);
	await waitForCentralState(page, "recovery-required");
	await expect(page.getByTestId("jetbrains-error")).toContainText("previous runtime was retained");
	await expect(page.getByTestId("settings-dialog")).not.toContainText(
		"E2E_EXTENSION_DIAGNOSTIC_SENTINEL",
	);

	writeFileSync(E2E_CENTRAL_STATE, "");
	await page.getByTestId("jetbrains-connect").click();
	await waitForCentralState(page, "configured");
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
});

test("cleans only exact historical legacy fields and preserves unrelated model configuration", async ({
	page,
}) => {
	await openAppFresh(page);
	const modelsPath = join(E2E_PI_AGENT_DIR, "models.json");
	const baseline = existsSync(modelsPath) ? JSON.parse(readFileSync(modelsPath, "utf8")) : {};
	const baselineProviders = baseline.providers ?? {};
	const staged = {
		...baseline,
		providers: {
			...baselineProviders,
			anthropic: {
				...baselineProviders.anthropic,
				baseUrl: "http://127.0.0.1:4567/wire/e2e-token/claude-code/anthropic",
				apiKey: "wire-proxy",
				keep: "anthropic-field",
			},
			openai: {
				...baselineProviders.openai,
				baseUrl: "http://127.0.0.1:4567/wire/e2e-token/pi/openai/v1",
				apiKey: "wire-proxy",
				keep: "openai-field",
			},
			lookalike: {
				baseUrl: "http://127.0.0.1:4567/wire/e2e-token/pi/anthropic",
				apiKey: "wire-proxy",
			},
		},
		keepTopLevel: true,
	};
	writeFileSync(modelsPath, `${JSON.stringify(staged, null, 2)}\n`);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await page.getByTestId("jetbrains-connect").click();
	await waitForCentralState(page, "configured");

	const expectedAnthropic = { ...baselineProviders.anthropic, keep: "anthropic-field" };
	delete expectedAnthropic.baseUrl;
	delete expectedAnthropic.apiKey;
	const expectedOpenai = { ...baselineProviders.openai, keep: "openai-field" };
	delete expectedOpenai.baseUrl;
	delete expectedOpenai.apiKey;
	const migrated = JSON.parse(readFileSync(modelsPath, "utf8"));
	const expected = {
		...baseline,
		providers: {
			...baselineProviders,
			anthropic: expectedAnthropic,
			openai: expectedOpenai,
			lookalike: {
				baseUrl: "http://127.0.0.1:4567/wire/e2e-token/pi/anthropic",
				apiKey: "wire-proxy",
			},
		},
		keepTopLevel: true,
	};
	// The isolated baseline can contain real provider credentials copied for @agent coverage. Never let an
	// assertion formatter print either object into Playwright output if migration regresses.
	if (!isDeepStrictEqual(migrated, expected)) {
		throw new Error("legacy migration did not preserve the isolated models baseline");
	}

	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
});

test("blocks disconnect with no fallback and links to the exact affected chat", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await page.getByTestId("jetbrains-connect").click();
	await waitForCentralState(page, "configured");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	await createWorkspaceViaDialog(page);
	await page.getByTestId("model-selector").click();
	await page.locator('[data-testid="model-option"][data-model-id="e2e-central-model"]').click();

	await openProviders(page);
	await waitForCentralState(page, "configured");
	await page.getByTestId("jetbrains-disconnect").click();
	await expect(page.getByTestId("jetbrains-model-blocked")).toBeVisible();
	await waitForCentralState(page, "blocked");
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);
	// Remount the card to prove the affected ids live in host status, not only the initiating response.
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	await openProviders(page);
	await waitForCentralState(page, "blocked");
	await expect(page.getByTestId("jetbrains-model-blocked")).toBeVisible();
	await page.getByTestId("jetbrains-affected-chat").click();
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	const activeChat = page.locator(
		'[data-testid="editor-tab"][data-kind="chat"][data-active="true"]',
	);
	await expect(activeChat).toBeVisible();

	// Leave this stateful host usable for every later spec in the lane: remove the deliberate blocker, then
	// finish the disconnect instead of letting the next test's fixture reset look like hostile artifact drift.
	await activeChat.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").click();
	const closedChat = page.getByTestId("closed-chat-row").first();
	await closedChat.getByTestId("closed-chat-delete").click();
	// Selecting Delete closes the dropdown immediately while its callback intentionally detaches the async
	// request. This is the only history entry, so the trigger disappearing—not the unmounted menu row—is the
	// durable signal that the host acknowledged deletion and the store removed the chat.
	await expect(page.getByTestId("chat-history")).toHaveCount(0);
	await openProviders(page);
	await waitForCentralState(page, "blocked");
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
});
