import { expect, test } from "@playwright/test";

test("renders the branded 3-column shell and connects to the host", async ({ page }) => {
	await page.goto("/");

	// The 3-column shell is present.
	await expect(page.getByTestId("shell")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.getByTestId("right-panel")).toBeVisible();

	// ThinkRail branding: the violet primary token is applied.
	const primary = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
	);
	expect(primary.toLowerCase()).toBe("#8c81ff");

	// The UI dials the host and the welcome handshake flips the status pill to connected.
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
});
