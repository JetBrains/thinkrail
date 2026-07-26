import { expect, test } from "@playwright/test";

// The Privacy settings section: the anonymous-usage-analytics toggle. The flag is SERVER-SYNCED
// (AppConfig.analyticsEnabled in config.json, converged via the settings.changed broadcast — no
// optimistic apply), so a flip survives a reload. The e2e host never actually sends anything
// regardless of the flag: it runs from source (no baked PostHog key ⇒ noop sink) on the dev channel.
// This test leaves the flag back ON so the shared e2e data dir stays in its default state.
test("privacy section toggles analytics off and the choice persists across a reload", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-privacy").click();
	await expect(dialog).toContainText("Usage analytics");

	// Fresh data dir → DEFAULT_CONFIG → analytics enabled (the opt-out posture).
	const toggle = page.getByTestId("analytics-toggle");
	await expect(toggle).toHaveAttribute("data-active", "true");

	// Flip off → converges on the settings.changed broadcast (the same round-trip as the theme picker).
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(dialog).toContainText("nothing is sent");

	// Server-synced: a reload comes back OFF (from server.welcome's config, not a fresh default).
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-privacy").click();
	await expect(toggle).toHaveAttribute("data-active", "false");

	// Restore the default so other specs see the data dir's default posture.
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
