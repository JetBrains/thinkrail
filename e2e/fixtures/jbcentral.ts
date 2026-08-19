import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { JBCENTRAL_STATUS_TTL_MS } from "@thinkrail/shared/jbcentral";
import {
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_CENTRAL_LOG,
	E2E_CENTRAL_STATE,
	E2E_FAKE_BIN_DIR,
	E2E_HOME_DIR,
} from "./paths";

/** The argv ThinkRail is allowed to invoke — every Central spec asserts the log holds nothing else. */
const REVIEWED_ARGV = [
	"--version",
	"status",
	"add pi",
	"remove pi",
	"proxy start --ensure-updated",
	"login",
	"update --install",
];

/** Open Settings → Providers and return the JetBrains AI card. */
export async function openProviders(page: Page): Promise<Locator> {
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();
	return page.getByTestId("jetbrains-ai-card");
}

/** Wait for the card's host-authored lifecycle state, then return it. */
export async function waitForCentralState(page: Page, state: string): Promise<Locator> {
	const card = page.getByTestId("jetbrains-ai-card");
	await expect(card).toHaveAttribute("data-state", state, { timeout: 15_000 });
	return card;
}

/** Every Central invocation so far, one argv line each. */
export function centralInvocations(): string[] {
	if (!existsSync(E2E_CENTRAL_LOG)) return [];
	return readFileSync(E2E_CENTRAL_LOG, "utf8").trim().split("\n").filter(Boolean);
}

export function centralInvocationCount(argv: string): number {
	return centralInvocations().filter((invocation) => invocation === argv).length;
}

export function assertOnlyReviewedArgv(): void {
	for (const invocation of centralInvocations()) {
		expect(REVIEWED_ARGV).toContain(invocation);
	}
}

/**
 * Run the Central fake the way a user would in their own shell — deliberately NOT through ThinkRail, so a
 * spec can drive the out-of-band changes the host is supposed to notice (`remove pi` on the host, a login
 * that clears the signed-out control). The host's own PATH is not inherited: only the fake's control
 * environment is passed, so an accidental real `central` can never be reached.
 */
export function runCentralOnHost(...argv: string[]): void {
	execFileSync(join(E2E_FAKE_BIN_DIR, "central"), argv, {
		env: {
			PATH: "/usr/bin:/bin",
			HOME: E2E_HOME_DIR,
			CENTRAL_STUB_STATE: E2E_CENTRAL_STATE,
			CENTRAL_STUB_LOG: E2E_CENTRAL_LOG,
			CENTRAL_STUB_EXTENSION_SOURCE: E2E_CENTRAL_EXTENSION_SOURCE,
		},
		stdio: "ignore",
	});
}

/**
 * Uninstall / reinstall the Central CLI by moving the lane's fake in and out of the host's PATH directory.
 * Nothing else about the host changes — in particular the global PI extension stays exactly where it was,
 * which is what makes "uninstalled while connected" distinguishable from "disconnected".
 */
export function setCentralInstalled(installed: boolean): void {
	const live = join(E2E_FAKE_BIN_DIR, "central");
	const hidden = join(E2E_FAKE_BIN_DIR, "central.uninstalled");
	if (installed === existsSync(live)) return;
	execFileSync("mv", [installed ? hidden : live, installed ? live : hidden]);
}

/**
 * Press Connect, refreshing until the card actually offers it.
 *
 * Connect is withheld while the host's auth verdict says signed out, and that verdict is cached and only
 * refreshed by a status read — so a verdict left over from a preceding scenario can hide the button for up to
 * the TTL. Refreshing until it appears is what a user does in exactly the same situation, and it keeps every
 * connect-driven scenario independent of what ran before it.
 */
export async function connectCentral(page: Page): Promise<void> {
	const connect = page.getByTestId("jetbrains-connect");
	await expect(async () => {
		if (!(await connect.isVisible())) await page.getByTestId("providers-refresh").click();
		await expect(connect).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await connect.click();
}

/** Wait until the host has completed at least one further version probe (each one appends to the log). */
export async function waitForVersionProbe(after: number): Promise<void> {
	await expect
		.poll(() => centralInvocationCount("--version"), { timeout: 15_000 })
		.toBeGreaterThan(after);
}

/**
 * Make the host re-probe Central status after auth or proxy state changed out of band.
 *
 * The observation is cached for `JBCENTRAL_STATUS_TTL_MS` and only refreshes while something reads status,
 * so a change made inside that window is deliberately still served stale. Waiting the window out and then
 * refreshing is the same thing a user does by returning to the panel — and it keeps the assertion about the
 * card's copy rather than about the cache.
 */
export async function reprobeCentralStatus(page: Page): Promise<void> {
	const probes = centralInvocationCount("status");
	await page.waitForTimeout(JBCENTRAL_STATUS_TTL_MS + 250);
	await page.getByTestId("providers-refresh").click();
	await expect
		.poll(() => centralInvocationCount("status"), { timeout: 15_000 })
		.toBeGreaterThan(probes);
}
