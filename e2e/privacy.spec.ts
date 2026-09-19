import { expect, test } from "@playwright/test";
import { seedAnalyticsConsent } from "./fixtures/analyticsConsent";

test("privacy controls additional data without disabling basics and persists across reload", async ({
	page,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, true, true);
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-privacy").click();
	await expect(dialog).toContainText("Usage analytics");

	const toggle = page.getByTestId("analytics-toggle");
	await expect(toggle).toHaveAttribute("data-active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(dialog).toContainText(
		"Share anonymous product usage and how you found ThinkRail. We never collect prompts, code, files, credentials, or account identity.",
	);
	await expect(dialog).toContainText(
		"Always-on basics: first packaged install, app launches, chat starts, message sends, and provider connections.",
	);
	await expect(dialog).toContainText(
		"Setup, agent runs, task completions, reviews, and pull-request outcomes.",
	);
	await expect(dialog).toContainText(
		"When additional sharing is on, a one-time journey/bridge link and normalized campaign source may connect how you found ThinkRail to usage for 30 days. Turning sharing off removes attribution from future events.",
	);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-privacy").click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
