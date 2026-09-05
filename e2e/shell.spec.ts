import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

async function installNativeWindowChrome(page: Page, platform: "macos" | "windows" | "linux") {
	await page.addInitScript(
		({ platform }) => {
			let snapshot = { maximized: false };
			const calls: string[] = [];
			const listeners = new Set<() => void>();
			Reflect.set(globalThis, "__THINKRAIL_NATIVE_WINDOW_CHROME_TEST_CALLS__", calls);
			Reflect.set(
				globalThis,
				"__THINKRAIL_NATIVE_WINDOW_CHROME__",
				Object.freeze({
					version: 1,
					platform,
					getSnapshot: () => snapshot,
					subscribe: (listener: () => void) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					minimize: () => calls.push("minimize"),
					toggleMaximize: () => {
						snapshot = { maximized: !snapshot.maximized };
						calls.push(snapshot.maximized ? "maximize" : "restore");
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

function nativeWindowChromeCalls(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		Reflect.get(globalThis, "__THINKRAIL_NATIVE_WINDOW_CHROME_TEST_CALLS__"),
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
	await expect(page.getByTestId("window-controls")).toHaveCount(0);
	await expect(page.getByTestId("native-resize-handle")).toHaveCount(0);
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

	await expect(page.getByRole("button", { name: "Minimize window" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Maximize window" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Close window" })).toBeVisible();
	await expect(page.getByTestId("native-resize-handle")).toHaveCount(0);
	await page.getByTestId("window-minimize").click();
	const maximize = page.getByTestId("window-toggle-maximize");
	await expect(maximize).toHaveAttribute("aria-label", "Maximize window");
	await maximize.click();
	await expect(maximize).toHaveAttribute("aria-label", "Restore window");
	await page.getByTestId("window-close").click();

	expect(await nativeWindowChromeCalls(page)).toEqual(["minimize", "maximize", "close"]);
});

test("native macOS chrome reserves traffic-light space without drawing duplicate controls", async ({
	page,
}) => {
	await installNativeWindowChrome(page, "macos");
	await page.goto("/");

	const topbar = page.getByTestId("shell").locator("header").first();
	await expect(topbar).toHaveAttribute("data-native-window-platform", "macos");
	await expect(page.getByTestId("window-controls")).toHaveCount(0);
	await expect(page.getByTestId("native-resize-handle")).toHaveCount(0);
	const logo = await page.getByTestId("brand-logo").boundingBox();
	expect(logo).not.toBeNull();
	expect(logo?.x).toBeGreaterThanOrEqual(80);
});

test("native Linux chrome exposes controls and delegates every-edge resize", async ({ page }) => {
	await installNativeWindowChrome(page, "linux");
	await page.goto("/");

	const topbar = page.getByTestId("shell").locator("header").first();
	await expect(topbar).toHaveAttribute("data-native-window-platform", "linux");
	await expect(page.getByTestId("window-controls")).toHaveAttribute("data-platform", "linux");
	await expect(page.getByRole("button", { name: "Minimize window" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Maximize window" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Close window" })).toBeVisible();
	await expect(page.getByTestId("native-resize-handle")).toHaveCount(8);
	const minimizeBox = await page.getByTestId("window-minimize").boundingBox();
	expect(minimizeBox).not.toBeNull();
	expect(minimizeBox?.width).toBeCloseTo(28, 0);
	const minimizeRadius = await page
		.getByTestId("window-minimize")
		.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderRadius));
	expect(minimizeRadius).toBeGreaterThan(10);
	await page.getByTestId("window-toggle-maximize").click();
	await expect(page.getByTestId("native-resize-handle")).toHaveCount(0);
	await page.getByTestId("window-toggle-maximize").click();
	await expect(page.getByTestId("native-resize-handle")).toHaveCount(8);

	await page
		.locator('[data-testid="native-resize-handle"][data-edge="east"]')
		.dispatchEvent("mousedown", { button: 0 });
	expect(await nativeWindowChromeCalls(page)).toEqual(["maximize", "restore", "resize:east"]);
});
