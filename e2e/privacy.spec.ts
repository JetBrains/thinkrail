import { expect, test } from "@playwright/test";
import { seedAnalyticsConsent } from "./fixtures/analyticsConsent";
import { closeSettings, openSettingsSection } from "./fixtures/app";

test("privacy controls additional data without disabling basics and persists across reload", async ({
	page,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, true, true);
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const dialog = await openSettingsSection(page, "privacy");
	await expect(dialog).toContainText("Usage analytics");

	const toggle = page.getByTestId("analytics-toggle");
	await expect(toggle).toHaveAttribute("data-active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(dialog).toContainText(
		"Share anonymous product usage and how you found ThinkRail. We never collect prompts, code, files, credentials, or account identity.",
	);
	await expect(dialog).toContainText(
		"Setup, agent runs, task completions, reviews, and pull-request outcomes.",
	);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await openSettingsSection(page, "privacy");
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.getByTestId("settings-reset-usage-analytics")).toHaveCount(0);

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();

	// Sharing is off by default, so Reset turns it back off.
	await page.getByTestId("settings-reset-usage-analytics").click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	await closeSettings(page);
});
