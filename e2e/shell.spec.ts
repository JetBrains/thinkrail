import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("renders the branded shell and, with no workspace, the Welcome screen", async ({ page }) => {
	await page.goto("/");

	await expect(page.getByTestId("shell")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);

	const { primary, themeId } = await page.evaluate(() => ({
		primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
		themeId: document.documentElement.getAttribute("data-theme"),
	}));
	expect(themeId).toBeTruthy();
	const manifest = JSON.parse(
		readFileSync(
			new URL(`../apps/web/src/themes/bundled/${themeId}.theme.json`, import.meta.url),
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

	await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
		"href",
		"/favicon.svg",
	);
	const faviconResponse = await page.request.get("/favicon.svg");
	expect(faviconResponse.ok()).toBe(true);
	const faviconSvg = await faviconResponse.text();
	expect(faviconSvg).toContain("<title>ThinkRail</title>");
	expect(faviconSvg).toContain("prefers-color-scheme: dark");
	await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute(
		"href",
		"/favicon.ico",
	);
	await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
		"href",
		"/apple-touch-icon.png",
	);
	for (const path of ["/favicon.ico", "/apple-touch-icon.png"]) {
		const response = await page.request.get(path);
		expect(response.ok()).toBe(true);
		expect(response.headers()["content-type"]).not.toContain("text/html");
	}

	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("aria-label", "Connected");
});
