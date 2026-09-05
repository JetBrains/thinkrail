import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function installNativeWindowChrome(page: Page, platform: "macos" | "windows" | "linux") {
	await page.addInitScript(
		({ platform }) => {
			let maximized = false;
			const calls: string[] = [];
			const listeners = new Set<() => void>();
			Reflect.set(globalThis, "__THINKRAIL_NATIVE_WINDOW_CHROME_TEST_CALLS__", calls);
			Reflect.set(
				globalThis,
				"__THINKRAIL_NATIVE_WINDOW_CHROME__",
				Object.freeze({
					version: 1,
					platform,
					getSnapshot: () => ({ maximized }),
					subscribe: (listener: () => void) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					minimize: () => calls.push("minimize"),
					toggleMaximize: () => {
						maximized = !maximized;
						calls.push(maximized ? "maximize" : "restore");
						for (const listener of listeners) listener();
					},
					requestClose: () => calls.push("close"),
					startResize: (edge: string) => calls.push(`resize:${edge}`),
				}),
			);
		},
		{ platform },
	);
}

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

test("native Windows capability turns the shared topbar into application chrome", async ({
	page,
}) => {
	await installNativeWindowChrome(page, "windows");
	await page.goto("/");

	const topbar = page.getByTestId("shell").locator("header").first();
	await expect(topbar).toHaveAttribute("data-native-window-platform", "windows");
	await expect(topbar).toHaveClass(/electrobun-webkit-app-region-drag/);
	await expect(page.getByTestId("connection-status")).toContainText("Connected");
	await expect(page.getByTestId("connection-status").locator("..")).toHaveClass(
		/electrobun-webkit-app-region-no-drag/,
	);

	await page.getByTestId("window-minimize").click();
	const maximize = page.getByTestId("window-toggle-maximize");
	await expect(maximize).toHaveAttribute("aria-label", "Maximize window");
	await maximize.click();
	await expect(maximize).toHaveAttribute("aria-label", "Restore window");
	await page.getByTestId("window-close").click();

	const calls = await page.evaluate(() =>
		Reflect.get(globalThis, "__THINKRAIL_NATIVE_WINDOW_CHROME_TEST_CALLS__"),
	);
	expect(calls).toEqual(["minimize", "maximize", "close"]);
});
