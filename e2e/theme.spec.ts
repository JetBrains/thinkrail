import { expect, test } from "@playwright/test";

// The Appearance settings section: the theme picker. Themes are SERVER-SYNCED (config.json on the host,
// delivered in server.welcome), so a pick survives a reload. This test leaves the host back on Dark so the
// shared e2e data dir stays in its default state for other specs.
test("appearance section switches the theme and persists it across a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const html = page.locator("html");
	// Fresh data dir → DEFAULT_CONFIG → Dark.
	await expect(html).toHaveAttribute("data-theme", "dark");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog).toContainText("Theme");

	// Dark is the active option to start.
	await expect(page.getByTestId("theme-option-dark")).toHaveAttribute("data-active", "true");

	// Pick Light → the swap applies (converged on the settings.changed broadcast) and the option marks active.
	await page.getByTestId("theme-option-light").click();
	await expect(html).toHaveAttribute("data-theme", "light");
	await expect(page.getByTestId("theme-option-light")).toHaveAttribute("data-active", "true");

	// Pick Darcula → applies live too.
	await page.getByTestId("theme-option-darcula").click();
	await expect(html).toHaveAttribute("data-theme", "darcula");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	// Server-synced: a reload comes back on Darcula (from server.welcome's config, not a fresh default).
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(html).toHaveAttribute("data-theme", "darcula");

	// Leave the host back on Dark so the shared data dir stays default for the other specs.
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await page.getByTestId("theme-option-dark").click();
	await expect(html).toHaveAttribute("data-theme", "dark");
});
