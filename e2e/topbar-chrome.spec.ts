import { writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import {
	enterDefaultWorkspace,
	openAppFresh,
	openFixtureProject,
	PHONE_VIEWPORT,
} from "./fixtures/app";
import { connectCentral, openProviders, waitForCentralState } from "./fixtures/jbcentral";
import { E2E_CENTRAL_STATE } from "./fixtures/paths";

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
	right: number;
	bottom: number;
}

async function bounds(locator: Locator): Promise<Rect> {
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
	buttonIds: string[] = ["open-settings"],
	dragRegion: "drag" | "no-drag" = "no-drag",
): Promise<void> {
	const header = page.getByTestId("topbar");
	const actions = page.getByTestId("topbar-actions");
	await expect(header).toHaveCSS("height", "40px");
	await expect(header).toHaveCSS("-webkit-app-region", dragRegion);
	await expect(actions).toHaveCSS("-webkit-app-region", "no-drag");
	const headerBox = await bounds(header);
	const actionsBox = await bounds(actions);
	const logoBox = await bounds(page.getByTestId("brand-logo"));
	const leftInsetBox = await bounds(page.getByTestId("window-chrome-inset-left"));
	const rightInsetBox = await bounds(page.getByTestId("window-chrome-inset-right"));
	expect(headerBox.x).toBe(0);
	expect(headerBox.y).toBe(0);
	expect(headerBox.width).toBe(page.viewportSize()?.width);
	expect(logoBox.width).toBe(32);
	expect(logoBox.height).toBe(32);
	expect(logoBox.x).toBeGreaterThanOrEqual(leftInsetBox.right);
	expect(actionsBox.right).toBeLessThanOrEqual(rightInsetBox.x);
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

async function headerColors(page: Page): Promise<{ actual: string; expected: string }> {
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

test("ordinary browsers have a fixed themed header with zero native insets", async ({ page }) => {
	await openAppFresh(page);
	const header = page.getByTestId("topbar");
	for (const side of ["left", "right"] as const) {
		const inset = page.getByTestId(`window-chrome-inset-${side}`);
		await expect(inset).toHaveAttribute("aria-hidden", "true");
		await expect(inset).toHaveCSS("width", "0px");
	}
	await expect(page.getByTestId("update-ready")).toHaveCount(0);
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
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	await page.setViewportSize(PHONE_VIEWPORT);
	await expectUsableHeader(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
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
			const workbenchBox = await bounds(workbench);
			expect(workbenchBox).toEqual(baselineWorkbench);
			expect(workbenchBox.y).toBe(40);
			await expect(page.getByTestId("scope-name")).toBeVisible();
			await expect(page.getByTestId("center-tabs")).toBeVisible();
			if (left === 80 && right === 138) {
				await testInfo.attach(`injected-insets-${viewport.width}`, {
					body: await page.getByTestId("topbar").screenshot({
						path: testInfo.outputPath(`injected-insets-${viewport.width}.png`),
					}),
					contentType: "image/png",
				});
			}
		}
	}
});

test("the action cluster keeps Update, quota Retry and Settings out of the drag region", async ({
	page,
}) => {
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
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	const buttons = ["update-ready", "jbcentral-quota", "open-settings"];
	await page.evaluate(() =>
		document.documentElement.style.setProperty("--window-chrome-drag-region", "drag"),
	);
	await setInsets(page, 80, 138);
	await expectUsableHeader(page, buttons, "drag");

	await setInsets(page, 0, 0);
	await page.setViewportSize(PHONE_VIEWPORT);
	await expectUsableHeader(page, buttons, "drag");

	await page.getByTestId("update-ready").click();
	await expect(page.getByTestId("settings-updates")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	await openProviders(page);
	await setQuotaInterval(page, 30);
	writeFileSync(E2E_CENTRAL_STATE, "");
	await page.getByTestId("jetbrains-disconnect").click();
	await waitForCentralState(page, "supported");
});
