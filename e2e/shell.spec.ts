import { readFileSync } from "node:fs";
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

	// ThinkRail branding: the accent token is applied. Read from the manifest rather than repeated
	// here — a hardcoded hex made this spec fail the moment the palette was tuned for contrast, which
	// is precisely the coupling the token system exists to remove.
	const primary = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
	);
	const manifest = JSON.parse(
		readFileSync(
			new URL("../apps/web/src/themes/bundled/dark.theme.json", import.meta.url),
			"utf8",
		),
	) as { colors: { accent: string } };
	expect(primary.toLowerCase()).toBe(manifest.colors.accent);

	// The UI dials the host and the welcome handshake flips the status pill to connected.
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
});
