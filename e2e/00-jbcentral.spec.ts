import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openAppFresh, openFixtureProject } from "./fixtures/app";
import {
	E2E_CENTRAL_ARTIFACT,
	E2E_CENTRAL_EXTENSION_SOURCE,
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
test("connects and follows external add, replacement, and remove without a host restart", async ({
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
	await expect(
		page.locator('[data-testid="provider-row"][data-provider="e2e-central"]'),
	).toHaveCount(0);

	// No Refresh click: provider.changed drives the open card to the host's watched state.
	rmSync(E2E_CENTRAL_ARTIFACT, { force: true });
	await waitForCentralState(page, "supported");
	await expect(page.getByTestId("jetbrains-connect")).toBeVisible();

	const replacement = readFileSync(E2E_CENTRAL_EXTENSION_SOURCE, "utf8")
		.replaceAll("e2e-central-model", "e2e-central-model-v2")
		.replace("Synthetic JetBrains AI model", "Synthetic JetBrains AI model v2");
	writeFileSync(E2E_CENTRAL_ARTIFACT, replacement);
	await waitForCentralState(page, "configuring");
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
	await waitForCentralState(page, "load-failed");
	await expect(page.getByTestId("jetbrains-load-failed")).toContainText(
		"previous runtime remains available",
	);
	await expect(page.getByTestId("settings-dialog")).not.toContainText(
		"E2E_EXTENSION_DIAGNOSTIC_SENTINEL",
	);

	writeFileSync(E2E_CENTRAL_STATE, "");
	await page.getByTestId("jetbrains-retry").click();
	await waitForCentralState(page, "configured");
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
});

test("disconnect removes Central from new chats while an existing live chat keeps its model", async ({
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
	await expect(page.getByTestId("model-selector")).toContainText("Synthetic JetBrains AI model");

	await openProviders(page);
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(false);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("model-selector")).toContainText("Synthetic JetBrains AI model");

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("model-selector").click();
	await expect(
		page.locator('[data-testid="model-option"][data-model-id="e2e-central-model"]'),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");

	// Dispose the retained session so this shared host does not carry the test's old generation onward.
	const activeChat = page.locator(
		'[data-testid="editor-tab"][data-kind="chat"][data-active="true"]',
	);
	await activeChat.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-row").first().getByTestId("closed-chat-delete").click();
	await expect(page.getByTestId("chat-history")).toHaveCount(0);
});
