import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("renders the branded shell and, with no workspace, the Welcome screen", async ({ page }) => {
	await page.goto("/");

	await expect(page.getByTestId("shell")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);

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

	const logo = page.getByTestId("brand-logo");
	await expect(logo).toBeVisible();
	await expect(logo).toHaveAttribute("aria-label", "ThinkRail");
	const logoBox = await logo.boundingBox();
	expect(logoBox).not.toBeNull();
	expect(logoBox?.height).toBeCloseTo(32, 0);
	expect(logoBox?.width).toBeCloseTo(32, 0);
	const logoColors = await logo.evaluate((element) => ({
		color: getComputedStyle(element).color,
		fill: getComputedStyle(element.querySelector("path") ?? element).fill,
	}));
	expect(logoColors.fill).toBe(logoColors.color);

	const favicon = page.locator('link[rel="icon"]');
	await expect(favicon).toHaveAttribute("type", "image/svg+xml");
	await expect(favicon).toHaveAttribute("href", "/favicon.svg");
	const faviconResponse = await page.request.get("/favicon.svg");
	expect(faviconResponse.ok()).toBe(true);
	const faviconSvg = await faviconResponse.text();
	expect(faviconSvg).toContain("<title>ThinkRail</title>");
	expect(faviconSvg).toContain("prefers-color-scheme: dark");

	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("aria-label", "Connected");
});
