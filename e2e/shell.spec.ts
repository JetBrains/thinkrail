import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("renders the branded shell and, with no workspace, the Welcome screen", async ({ page }) => {
	await page.goto("/");

	// The shell + projects rail are present, and (no workspace active on a fresh load) the Welcome screen
	// fills the rest — no workspace workbench is mounted.
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

	// The top-left identity is the supplied vector wordmark, not the former text treatment. Its paths
	// inherit the semantic theme colour and its intrinsic aspect ratio remains intact at the 18px target.
	const logo = page.getByTestId("brand-logo");
	await expect(logo).toBeVisible();
	await expect(logo).toHaveAttribute("aria-label", "ThinkRail");
	const logoBox = await logo.boundingBox();
	expect(logoBox).not.toBeNull();
	expect(logoBox?.height).toBeCloseTo(18, 0);
	expect((logoBox?.width ?? 0) / (logoBox?.height ?? 1)).toBeCloseTo(3210 / 450, 1);
	const logoColors = await logo.evaluate((element) => ({
		color: getComputedStyle(element).color,
		fill: getComputedStyle(element.querySelector("path") ?? element).fill,
	}));
	expect(logoColors.fill).toBe(logoColors.color);

	// The browser-tab icon is a local, compact crop of the same mark and handles light/dark chrome.
	const favicon = page.locator('link[rel="icon"]');
	await expect(favicon).toHaveAttribute("type", "image/svg+xml");
	await expect(favicon).toHaveAttribute("href", "/favicon.svg");
	const faviconResponse = await page.request.get("/favicon.svg");
	expect(faviconResponse.ok()).toBe(true);
	const faviconSvg = await faviconResponse.text();
	expect(faviconSvg).toContain("<title>ThinkRail</title>");
	expect(faviconSvg).toContain("prefers-color-scheme: dark");

	// The UI dials the host and the welcome handshake flips the status pill to connected.
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("aria-label", "Connected");
});
