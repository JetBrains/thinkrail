import { writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type {
	NativeUpdateBridge,
	NativeUpdateState,
	NativeWindowAppearance,
	NativeWindowChromeBridge,
} from "@thinkrail/contracts";
import {
	enterDefaultWorkspace,
	openAppFresh,
	openFixtureProject,
	PHONE_VIEWPORT,
} from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_CENTRAL_STATE } from "./fixtures/paths";

async function bounds(locator: Locator) {
	return locator.evaluate((element) => {
		const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
		return { x, y, width, height, right, bottom };
	});
}

async function setInsets(page: Page, left: number, right: number): Promise<void> {
	await page.evaluate(
		(insets) => {
			for (const [side, value] of Object.entries(insets)) {
				document.documentElement.style.setProperty(`--window-chrome-inset-${side}`, `${value}px`);
			}
		},
		{ left, right },
	);
	await expect(page.getByTestId("window-chrome-inset-left")).toHaveCSS("width", `${left}px`);
	await expect(page.getByTestId("window-chrome-inset-right")).toHaveCSS("width", `${right}px`);
}

async function expectUsableHeader(
	page: Page,
	buttonIds = ["open-settings"],
	dragRegion: "drag" | "no-drag" = "no-drag",
): Promise<void> {
	const header = page.getByTestId("topbar");
	const actions = page.getByTestId("topbar-actions");
	await expect(header).toHaveCSS("height", "40px");
	await expect(header).toHaveCSS("-webkit-app-region", dragRegion);
	await expect(actions).toHaveCSS("-webkit-app-region", "no-drag");
	expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	const headerBox = await bounds(header);
	const actionsBox = await bounds(actions);
	const logoBox = await bounds(page.getByTestId("brand-logo"));
	expect(headerBox.x).toBe(0);
	expect(headerBox.y).toBe(0);
	expect(headerBox.width).toBe(page.viewportSize()?.width);
	expect(logoBox.width).toBe(32);
	expect(logoBox.height).toBe(32);
	expect(logoBox.x).toBeGreaterThanOrEqual(
		(await bounds(page.getByTestId("window-chrome-inset-left"))).right,
	);
	expect(actionsBox.right).toBeLessThanOrEqual(
		(await bounds(page.getByTestId("window-chrome-inset-right"))).x,
	);
	expect(logoBox.right).toBeLessThanOrEqual(actionsBox.x);
	expect(actionsBox.y).toBeGreaterThanOrEqual(headerBox.y);
	expect(actionsBox.bottom).toBeLessThanOrEqual(headerBox.bottom);
	for (const testId of buttonIds) {
		const button = actions.getByTestId(testId);
		await expect(button).toBeInViewport({ ratio: 1 });
		const box = await bounds(button);
		expect(box.x).toBeGreaterThanOrEqual(actionsBox.x);
		expect(box.right).toBeLessThanOrEqual(actionsBox.right);
		expect(box.y).toBeGreaterThanOrEqual(actionsBox.y);
		expect(box.bottom).toBeLessThanOrEqual(actionsBox.bottom);
	}
}

async function headerColors(page: Page) {
	return page.getByTestId("topbar").evaluate((header) => {
		const probe = document.createElement("div");
		probe.style.backgroundColor = "var(--container-header-bg)";
		document.body.append(probe);
		const expected = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return { actual: getComputedStyle(header).backgroundColor, expected };
	});
}

async function setQuotaInterval(page: Page, seconds: number): Promise<void> {
	const interval = page.getByTestId("jbcentral-quota-interval");
	await interval.fill(String(seconds));
	await interval.press("Enter");
	await expect(interval).toHaveValue(String(seconds));
}

async function selectOppositeAppearanceTheme(page: Page): Promise<string> {
	const selected = page.locator('[data-testid^="theme-option-"][data-active="true"]');
	const originalTheme = await selected.getAttribute("data-theme-id");
	const appearance = await selected.getAttribute("data-appearance");
	if (!originalTheme) throw new Error("No selected theme");
	await page
		.locator(
			`[data-testid^="theme-option-"][data-appearance="${appearance === "light" ? "dark" : "light"}"]`,
		)
		.first()
		.click();
	return originalTheme;
}

test("ordinary browsers have a fixed themed header with zero native insets", async ({
	page,
}, testInfo) => {
	await openAppFresh(page);
	const header = page.getByTestId("topbar");
	for (const side of ["left", "right"]) {
		const inset = page.getByTestId(`window-chrome-inset-${side}`);
		await expect(inset).toHaveAttribute("aria-hidden", "true");
		await expect(inset).toHaveCSS("width", "0px");
	}
	await expect(page.getByTestId("native-update-ready")).toHaveCount(0);
	await expectUsableHeader(page);
	expect((await bounds(page.getByTestId("welcome-shell-layout"))).y).toBe(40);
	const initialColors = await headerColors(page);
	expect(initialColors.actual).toBe(initialColors.expected);

	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await expect(page.getByTestId("settings-nav-updates")).toHaveCount(0);
	await page.getByTestId("settings-nav-appearance").click();
	const originalTheme = await selectOppositeAppearanceTheme(page);
	await expect(header).not.toHaveCSS("background-color", initialColors.actual);
	const changedColors = await headerColors(page);
	expect(changedColors.actual).toBe(changedColors.expected);
	await expect(header).toHaveCSS("height", "40px");
	await page.getByTestId(`theme-option-${originalTheme}`).click();
	await expect(header).toHaveCSS("background-color", initialColors.actual);
	await page.keyboard.press("Escape");

	await page.setViewportSize(PHONE_VIEWPORT);
	await expectUsableHeader(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await testInfo.attach("browser-header", {
		body: await header.screenshot({ path: testInfo.outputPath("browser-header.png") }),
		contentType: "image/png",
	});
});

test("live safe areas on either edge preserve header and workbench geometry", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.evaluate(() => document.fonts.ready);
	const logo = page.getByTestId("brand-logo");
	const actions = page.getByTestId("topbar-actions");
	const workbench = page.getByTestId("workspace-shell-layout");

	for (const viewport of [{ width: 1280, height: 720 }, PHONE_VIEWPORT]) {
		await page.setViewportSize(viewport);
		await setInsets(page, 0, 0);
		const baselineLogo = await bounds(logo);
		const baselineActions = await bounds(actions);
		const baselineWorkbench = await bounds(workbench);
		for (const [left, right] of [
			[80, 138],
			[96, 0],
			[0, 112],
			[0, 0],
		] as const) {
			await setInsets(page, left, right);
			await expectUsableHeader(page);
			expect((await bounds(logo)).x).toBeCloseTo(baselineLogo.x + left, 1);
			expect((await bounds(actions)).right).toBeCloseTo(baselineActions.right - right, 1);
			expect(await bounds(workbench)).toEqual(baselineWorkbench);
			expect(baselineWorkbench.y).toBe(40);
			await expect(page.getByTestId("scope-name")).toBeVisible();
			await expect(page.getByTestId("center-tabs")).toBeVisible();
			if (left > 0 && right > 0) {
				await testInfo.attach(`injected-insets-${viewport.width}`, {
					body: await page.getByTestId("topbar").screenshot({
						path: testInfo.outputPath(`injected-insets-${viewport.width}.png`),
					}),
					contentType: "image/png",
				});
			}
		}
	}
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
});

test("the entire action cluster excludes Update ready, both quota Retry states, and Settings from drag", async ({
	page,
}, testInfo) => {
	await page.addInitScript(() => {
		const state: NativeUpdateState = {
			revision: 1,
			status: "ready",
			version: "0.1.0",
			channel: "stable",
			availableVersion: "0.1.1",
			progress: null,
			error: null,
		};
		const bridge: NativeUpdateBridge = {
			getState: async () => state,
			checkForUpdates: async () => {},
			restartToUpdate: async () => {},
			subscribe: () => () => {},
		};
		Object.defineProperty(globalThis, "__THINKRAIL_NATIVE_UPDATES__", { value: bridge });
	});
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openProviders(page);
	await waitForCentralState(page, "supported");
	await setQuotaInterval(page, 3600);
	writeFileSync(E2E_CENTRAL_STATE, "quota-error");
	await connectCentral(page);
	await waitForCentralState(page, "configured");
	const quota = page.getByTestId("jbcentral-quota");
	await expect(quota).toHaveAttribute("data-state", "unavailable");
	await page.keyboard.press("Escape");
	const buttons = ["native-update-ready", "jbcentral-quota", "open-settings"];
	await page.evaluate(() =>
		document.documentElement.style.setProperty("--window-chrome-drag-region", "drag"),
	);
	await setInsets(page, 80, 138);
	await expectUsableHeader(page, buttons, "drag");

	await setInsets(page, 0, 0);
	await page.setViewportSize(PHONE_VIEWPORT);
	await expectUsableHeader(page, buttons, "drag");
	await page.getByTestId("native-update-ready").click();
	await expect(page.getByTestId("settings-updates")).toBeVisible();
	await expect(page.getByTestId("native-update-status")).toHaveAttribute("data-status", "ready");
	await page.getByTestId("native-update-later").click();
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	await expect(page.getByTestId("native-update-ready")).toBeVisible();

	writeFileSync(E2E_CENTRAL_STATE, "quota-alt");
	await quota.click();
	await expect(quota).toHaveAttribute("data-state", "available");
	await expect(quota).toContainText("18.5 / 20");
	await openProviders(page);
	writeFileSync(E2E_CENTRAL_STATE, "quota-error");
	await setQuotaInterval(page, 1);
	await expect(quota).toHaveAttribute("data-state", "stale");
	await setQuotaInterval(page, 3600);
	await page.keyboard.press("Escape");
	await expectUsableHeader(page, buttons, "drag");
	await expect(quota.getByText("credits", { exact: true })).toBeHidden();
	await expect(page.getByTestId("connection-status").getByText("Connected")).toBeHidden();
	expect(await quota.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
	await testInfo.attach("narrow-ready-and-retry", {
		body: await page.getByTestId("topbar").screenshot({
			path: testInfo.outputPath("narrow-ready-and-retry.png"),
		}),
		contentType: "image/png",
	});
	writeFileSync(E2E_CENTRAL_STATE, "");
	await quota.click();
	await expect(quota).toHaveAttribute("data-state", "available");
	await expect(quota).toContainText("19.92 / 20");
	await openProviders(page);
	await setQuotaInterval(page, 30);
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
});

test("native appearance follows the rendered header on theme and forced-color changes", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const appearances: NativeWindowAppearance[] = [];
		const bridge: NativeWindowChromeBridge = {
			setAppearance: (appearance) => appearances.push(appearance),
		};
		Object.defineProperty(globalThis, "__TEST_WINDOW_APPEARANCES__", { value: appearances });
		Object.defineProperty(globalThis, "__THINKRAIL_NATIVE_WINDOW_CHROME__", { value: bridge });
	});
	await openAppFresh(page);
	const lastAppearance = () =>
		page.evaluate(() => {
			const appearances: unknown = Reflect.get(globalThis, "__TEST_WINDOW_APPEARANCES__");
			if (!Array.isArray(appearances)) throw new Error("Missing appearance test receiver");
			return appearances.at(-1);
		});
	const headerAppearance = () =>
		page.getByTestId("topbar").evaluate((header) => {
			const style = getComputedStyle(header);
			return { backgroundColor: style.backgroundColor, colorScheme: style.colorScheme };
		});
	const initial = await headerAppearance();
	await expect.poll(lastAppearance).toEqual(initial);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	const originalTheme = await selectOppositeAppearanceTheme(page);
	await expect
		.poll(async () => (await headerAppearance()).colorScheme)
		.not.toBe(initial.colorScheme);
	const changed = await headerAppearance();
	await expect.poll(lastAppearance).toEqual(changed);
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ forcedColors: "active", colorScheme });
		const forced = await headerAppearance();
		expect(forced.colorScheme).toBe("light dark");
		await expect.poll(lastAppearance).toEqual({
			backgroundColor: forced.backgroundColor,
			colorScheme,
		});
	}
	await page.emulateMedia({ forcedColors: "none", colorScheme: null });
	await page.getByTestId(`theme-option-${originalTheme}`).click();
	await expect.poll(lastAppearance).toEqual(initial);
});
