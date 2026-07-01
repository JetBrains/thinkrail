import { expect, test } from "@playwright/test";

// The Settings dialog's "Local GitHub" block. The e2e host forces gh offline
// (THINKRAIL_PI_GH_OFFLINE), so it must degrade to "Not connected" — proving the graceful-degrade path.
test("settings shows the Local GitHub status block and degrades gh gracefully", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("Local GitHub");

	// gh is forced offline → Not connected, but the block (and its Refresh) still render.
	const status = page.getByTestId("settings-gh-status");
	await expect(status).toHaveAttribute("data-connected", "false");
	await expect(status).toContainText("Not connected");
	await expect(page.getByTestId("settings-gh-refresh")).toBeVisible();

	// Refresh re-probes gh (still offline here) without throwing — status stays "Not connected".
	await page.getByTestId("settings-gh-refresh").click();
	await expect(status).toHaveAttribute("data-connected", "false");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
