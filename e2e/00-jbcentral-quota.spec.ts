import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import {
	assertOnlyReviewedArgv,
	centralInvocationCount,
	connectCentral,
	openProviders,
	waitForCentralState,
} from "./fixtures/jbcentral";
import { E2E_CENTRAL_STATE } from "./fixtures/paths";

const quota = (page: import("@playwright/test").Page) => page.getByTestId("jbcentral-quota");

async function setIntervalSeconds(
	page: import("@playwright/test").Page,
	seconds: number,
): Promise<void> {
	const interval = page.getByTestId("jbcentral-quota-interval");
	await interval.fill(String(seconds));
	await interval.press("Enter");
	await expect(interval).toHaveValue(String(seconds));
}

test("top-bar quota follows healthy Central and exposes only recurring values", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");

	await expect(quota(page)).toHaveAttribute("data-state", "available");
	await expect(quota(page)).toContainText("19.92 / 20");
	await expect(page.getByTestId("shell")).not.toContainText("E2E_CENTRAL_CHILD_SENTINEL");
	await expect(page.getByTestId("shell")).not.toContainText("99.00");

	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	await expect(quota(page)).toHaveCount(0);
	assertOnlyReviewedArgv();
});

test("provider settings control quota polling and validate the shared interval", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	const toggle = page.getByTestId("jbcentral-quota-toggle");
	const interval = page.getByTestId("jbcentral-quota-interval");
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(interval).toHaveValue("30");

	await interval.fill("1");
	await interval.press("Enter");
	await expect(interval).toHaveValue("1");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await expect(quota(page)).toHaveAttribute("data-state", "available");

	const beforeRefresh = centralInvocationCount("quota --json");
	writeFileSync(E2E_CENTRAL_STATE, "quota-alt");
	await expect
		.poll(() => centralInvocationCount("quota --json"), { timeout: 5_000 })
		.toBeGreaterThan(beforeRefresh);
	await expect(quota(page)).toContainText("18.5 / 20");

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(interval).toBeDisabled();
	await expect(interval).toHaveValue("1");
	await expect(quota(page)).toHaveCount(0);
	const disabledCount = centralInvocationCount("quota --json");
	await page.waitForTimeout(1_300);
	expect(centralInvocationCount("quota --json")).toBe(disabledCount);

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(interval).toBeEnabled();
	await expect(quota(page)).toHaveAttribute("data-state", "available");

	await interval.fill("0");
	await interval.press("Enter");
	await expect(page.getByTestId("jbcentral-quota-interval-error")).toContainText("1 to 3600");
	await interval.fill("30");
	await interval.press("Enter");
	await expect(page.getByTestId("jbcentral-quota-interval-error")).toHaveCount(0);
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
});

test("stale quota keeps its value, retries immediately, and preserves both numbers on mobile", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await expect(quota(page)).toHaveAttribute("data-state", "available");

	writeFileSync(E2E_CENTRAL_STATE, "quota-error");
	await setIntervalSeconds(page, 1);
	await expect(quota(page)).toHaveAttribute("data-state", "stale");
	await expect(quota(page)).toContainText("19.92 / 20");
	await expect(page.getByTestId("jbcentral-quota-stale-marker")).toBeVisible();

	await setIntervalSeconds(page, 3600);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	writeFileSync(E2E_CENTRAL_STATE, "quota-alt");
	await quota(page).click();
	await expect(quota(page)).toHaveAttribute("data-state", "available");
	await expect(quota(page)).toContainText("18.5 / 20");

	await page.setViewportSize({ width: 390, height: 780 });
	await expect(quota(page).getByText("credits", { exact: true })).toBeHidden();
	await expect(
		page.getByTestId("connection-status").getByText("Connected", { exact: true }),
	).toBeHidden();
	await expect(quota(page)).toContainText("18.5 / 20");

	await openProviders(page);
	await setIntervalSeconds(page, 30);
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
});

test("quota polling pauses while the page is hidden and refreshes when visible again", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await setIntervalSeconds(page, 1);
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	await expect(quota(page)).toHaveAttribute("data-state", "available");

	await page.evaluate(() => {
		Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await expect(quota(page)).toHaveCount(0);
	const hiddenCount = centralInvocationCount("quota --json");
	await page.waitForTimeout(1_300);
	expect(centralInvocationCount("quota --json")).toBe(hiddenCount);

	writeFileSync(E2E_CENTRAL_STATE, "quota-alt");
	await page.evaluate(() => {
		Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await expect(quota(page)).toContainText("18.5 / 20");
	await setIntervalSeconds(page, 30);
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
	assertOnlyReviewedArgv();
});
