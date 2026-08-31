import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openAppFresh, openFixtureProject } from "./fixtures/app";
import {
	assertOnlyReviewedArgv,
	centralInvocations,
	connectCentral,
	openProviders,
	waitForCentralState,
} from "./fixtures/jbcentral";
import {
	E2E_CENTRAL_ARTIFACT,
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_CENTRAL_STATE,
	E2E_FAKE_BIN_DIR,
	E2E_PI_AGENT_DIR,
} from "./fixtures/paths";

test("connects and follows external add, replacement, and remove without a host restart", async ({
	page,
}) => {
	await openAppFresh(page);
	const card = await openProviders(page);
	await waitForCentralState(page, "supported");

	await connectCentral(page);
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

test("guides absent, outdated, malformed, and failed Central version states", async ({ page }) => {
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
	await expect(page.getByTestId("jetbrains-outdated")).toContainText("1.3.9");
	await page.getByTestId("jetbrains-update").click();
	await waitForCentralState(page, "supported");

	writeFileSync(E2E_CENTRAL_STATE, "newer");
	await page.getByTestId("providers-refresh").click();
	await waitForCentralState(page, "supported");
	await expect(page.getByTestId("jetbrains-connect")).toBeVisible();

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

test("a Connect failure with credentials intact offers sign-in without exposing child output", async ({
	page,
}) => {
	await openAppFresh(page);
	writeFileSync(E2E_CENTRAL_STATE, "add-error");
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await expect(page.getByTestId("jetbrains-signed-out")).toHaveCount(0);
	await expect(page.getByTestId("jetbrains-ready")).toBeVisible();

	await connectCentral(page);
	await expect(page.getByTestId("jetbrains-signin-guidance")).toBeVisible();
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	await page.getByTestId("jetbrains-signin").click();
	await expect(page.getByTestId("jetbrains-login-launched")).toBeVisible();

	await expect.poll(() => centralInvocations(), { timeout: 10_000 }).toContain("login");
	assertOnlyReviewedArgv();
});

test("surfaces missing-artifact and candidate failures as closed UI states, then repairs", async ({
	page,
}) => {
	await openAppFresh(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");

	writeFileSync(E2E_CENTRAL_STATE, "missing-artifact");
	await connectCentral(page);
	await expect(page.getByTestId("jetbrains-error")).toContainText("couldn't confirm");
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");

	writeFileSync(E2E_CENTRAL_STATE, "candidate-error");
	await connectCentral(page);
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

test("a refused removal and a removal that leaves the artifact are both closed failures", async ({
	page,
}) => {
	await openAppFresh(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");

	writeFileSync(E2E_CENTRAL_STATE, "remove-error");
	await page.getByTestId("jetbrains-disconnect").click();
	await expect(page.getByTestId("jetbrains-error")).toContainText("couldn't disconnect");
	await expect(page.getByTestId("settings-dialog")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	await waitForCentralState(page, "configured");
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);

	writeFileSync(E2E_CENTRAL_STATE, "remove-leaves-artifact");
	await page.getByTestId("jetbrains-disconnect").click();
	await expect(page.getByTestId("jetbrains-error")).toContainText("couldn't confirm");
	await waitForCentralState(page, "configured");
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(true);

	writeFileSync(E2E_CENTRAL_STATE, "");
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	expect(existsSync(E2E_CENTRAL_ARTIFACT)).toBe(false);
	assertOnlyReviewedArgv();
});

test("a failed Update leaves the outdated guidance in place instead of a false recovery", async ({
	page,
}) => {
	await openAppFresh(page);
	await openProviders(page);
	writeFileSync(E2E_CENTRAL_STATE, "outdated update-error");
	await page.getByTestId("providers-refresh").click();
	await waitForCentralState(page, "outdated");

	await page.getByTestId("jetbrains-update").click();
	await expect(page.getByTestId("jetbrains-error")).toContainText("couldn't update");
	await waitForCentralState(page, "outdated");
	await expect(page.getByTestId("jetbrains-outdated")).toContainText("1.3.9");
	await expect(page.getByTestId("jetbrains-update")).toBeVisible();
	expect(centralInvocations()).toContain("update --install");

	writeFileSync(E2E_CENTRAL_STATE, "outdated");
	await page.getByTestId("jetbrains-update").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
});

test("disconnect removes Central from new chats while an existing live chat keeps its model", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
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

	const activeChat = page.locator(
		'[data-testid="editor-tab"][data-kind="chat"][data-active="true"]',
	);
	await activeChat.getByTestId("editor-tab-close").click();
	await page.getByTestId("chat-history").first().click();
	await page.getByTestId("closed-chat-row").first().getByTestId("closed-chat-delete").click();
	await expect(page.getByTestId("chat-history")).toHaveCount(0);
});
