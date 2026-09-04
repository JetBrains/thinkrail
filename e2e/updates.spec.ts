import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

const BANNER = '[data-testid="update-banner"]';

test(
	"release awareness: check → banner → dismiss → install → restart to finish",
	{ tag: "@dev-seam" },
	async ({ page }) => {
		await openAppFresh(page);

		await expect(page.locator(BANNER)).toHaveCount(0);
		await expect(page.getByTestId("update-indicator")).toHaveCount(0);

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-updates").click();
		const settings = page.getByTestId("settings-updates");
		await expect(settings).toBeVisible();
		await expect(page.getByTestId("update-current")).toContainText("ThinkRail 1.2.3");
		await expect(page.getByTestId("update-state")).toHaveAttribute("data-phase", "idle");
		await expect(settings).toContainText("ThinkRail is up to date");

		await page.getByTestId("update-check").click();
		await expect(page.getByTestId("update-state")).toHaveAttribute("data-phase", "available");
		await expect(settings).toContainText("ThinkRail 1.4.0 is available");
		const notes = page.getByTestId("update-notes");
		await expect(notes).toHaveAttribute("href", "https://e2e.test/releases/tag/v1.4.0");
		await expect(notes).toHaveAttribute("rel", "noopener noreferrer");
		await expect(page.getByTestId("update-channel-stable")).toHaveAttribute("data-active", "true");
		await expect(page.getByTestId("update-channel-nightly")).toHaveAttribute("data-active", "false");

		await page.keyboard.press("Escape");
		await expect(page.getByTestId("settings-dialog")).toBeHidden();
		await expect(page.locator(BANNER)).toHaveAttribute("data-kind", "available");
		await expect(page.locator(BANNER)).toContainText("ThinkRail 1.4.0 is available");
		await expect(page.getByTestId("update-indicator")).toHaveAttribute("data-kind", "available");

		await page.getByTestId("update-banner-dismiss").click();
		await expect(page.locator(BANNER)).toHaveCount(0);
		await expect(page.getByTestId("update-indicator")).toHaveAttribute("data-kind", "available");

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-updates").click();
		await page.getByTestId("update-install").click();
		await expect(page.getByTestId("update-state")).toHaveAttribute("data-phase", "staged");
		await expect(page.getByTestId("update-restart-hint")).toContainText("Restart ThinkRail");

		await page.keyboard.press("Escape");
		await expect(page.locator(BANNER)).toHaveAttribute("data-kind", "staged");
		await expect(page.locator(BANNER)).toContainText("restart to finish");
		await expect(page.getByTestId("update-indicator")).toHaveAttribute("data-kind", "staged");
	},
);

test(
	"turning off automatic checks removes the manual check too",
	{ tag: "@dev-seam" },
	async ({ page }) => {
		await openAppFresh(page);
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-updates").click();
		await expect(page.getByTestId("update-check")).toBeVisible();

		await page.getByTestId("update-checks-toggle").click();
		await expect(page.getByTestId("settings-updates")).toContainText("no release check leaves");
		await expect(page.getByTestId("update-check")).toHaveCount(0);

		await page.getByTestId("update-checks-toggle").click();
		await expect(page.getByTestId("update-check")).toBeVisible();
	},
);
