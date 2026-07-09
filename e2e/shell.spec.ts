import { expect, test } from "@playwright/test";

test("renders the branded shell and, with no workspace, the Welcome screen", async ({ page }) => {
	await page.goto("/");

	// The shell + projects rail are present, and (no workspace active on a fresh load) the Welcome screen
	// fills the rest — the center/right/terminal surface is not mounted.
	await expect(page.getByTestId("shell")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);

	// ThinkRail branding: the violet primary token is applied.
	const primary = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
	);
	expect(primary.toLowerCase()).toBe("#8c81ff");

	// The UI dials the host and the welcome handshake flips the status pill to connected.
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
});
