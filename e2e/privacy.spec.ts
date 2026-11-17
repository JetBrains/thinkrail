import { expect, test } from "@playwright/test";
import { offerAdditionalAnalytics, seedAnalyticsConsent } from "./fixtures/analyticsConsent";

test("privacy controls additional data without disabling basics and persists across reload", async ({
	page,
	baseURL,
}) => {
	await offerAdditionalAnalytics(page);
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
		"Setup, agent runs, task completions, reviews, and pull-request outcomes.",
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

test("without additional sharing on offer, Privacy only says what is sent", async ({
	page,
	baseURL,
}) => {
	await seedAnalyticsConsent(baseURL, false, false);
	try {
		await page.goto("/");
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(page.getByTestId("analytics-consent-dialog")).toBeHidden();

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-privacy").click();
		const privacy = page.getByTestId("settings-privacy");
		await expect(privacy).toContainText("Usage analytics");
		await expect(privacy).toContainText(
			"installs, updates, and one daily note that you sent messages, with how many",
		);
		await expect(privacy.getByTestId("analytics-toggle")).toHaveCount(0);
	} finally {
		await seedAnalyticsConsent(baseURL, false, true);
	}
});
