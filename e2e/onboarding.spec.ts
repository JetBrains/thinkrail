import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

// The first-run onboarding overlay: a large card floating over the still-visible IDE. It auto-opens once
// (guarded by a localStorage "seen" flag), blocks dismissal on first run, and is re-openable from the
// left-panel help button in a dismissible "review" mode. The global storageState seeds "seen" so the
// blocking overlay never covers the rest of the suite. Two screens: worktrees root → feature carousel.

test.describe("onboarding first run", () => {
	// Override the global "seen" seed so the overlay auto-opens as a blocking first run.
	test.use({ storageState: { cookies: [], origins: [] } });

	test("auto-opens, blocks Escape, and confirms path → get started", async ({ page }) => {
		await openAppFresh(page);

		const overlay = page.getByTestId("onboarding");
		await expect(overlay).toBeVisible();

		// The IDE stays visible beneath the overlay (this is a card, not a full-screen takeover).
		await expect(page.getByTestId("shell")).toBeVisible();

		// Screen 1 shows the worktrees root inside the media placeholder; Escape must NOT dismiss a
		// blocking first run.
		await expect(page.getByTestId("onboarding-root")).toContainText(".thinkrail/worktrees");
		await page.keyboard.press("Escape");
		await expect(overlay).toBeVisible();

		// Confirm path advances to screen 2; Get started finishes.
		await page.getByTestId("onboarding-next").click();
		await expect(page.getByTestId("onboarding-feature-0")).toBeVisible();
		await page.getByTestId("onboarding-done").click();
		await expect(overlay).toBeHidden();
	});
});

test.describe("onboarding review", () => {
	test("help button re-opens in review mode, and Escape dismisses it", async ({ page }) => {
		await openAppFresh(page);
		// Seeded "seen" flag → no auto-open.
		await expect(page.getByTestId("onboarding")).toHaveCount(0);

		await page.getByTestId("open-docs").click();
		const overlay = page.getByTestId("onboarding");
		await expect(overlay).toBeVisible();

		// Review mode is dismissible.
		await page.keyboard.press("Escape");
		await expect(overlay).toBeHidden();
	});

	test("screen 1 offers a docs link; screen 2's feature carousel swaps the media", async ({
		page,
	}) => {
		await openAppFresh(page);
		await page.getByTestId("open-docs").click();
		const overlay = page.getByTestId("onboarding");
		await expect(overlay).toBeVisible();

		// Screen 1: the docs link replaced the old inline "?" help.
		await expect(page.getByTestId("worktree-help")).toHaveCount(0);
		const docs = page.getByTestId("onboarding-docs");
		await expect(docs).toContainText("Learn more in docs");
		await expect(docs).toHaveAttribute("href", /github\.com\/.+README\.md/);

		// Screen 2 ("Key features"): a manual pick stops autoplay and swaps the media placeholder.
		await page.getByTestId("onboarding-next").click();
		const media = page.getByTestId("onboarding-media");
		await expect(page.getByTestId("onboarding-feature-0")).toHaveAttribute("data-active", "true");
		await expect(media).toContainText("Isolated git worktrees");

		await page.getByTestId("onboarding-feature-2").click();
		await expect(page.getByTestId("onboarding-feature-2")).toHaveAttribute("data-active", "true");
		await expect(page.getByTestId("onboarding-feature-0")).toHaveAttribute("data-active", "false");
		await expect(media).toContainText("Parallel agent sessions");

		// A manual pick stops autoplay for good: waiting past the 5s cadence, selection does not advance.
		await page.waitForTimeout(5500);
		await expect(page.getByTestId("onboarding-feature-2")).toHaveAttribute("data-active", "true");

		// The pagination indicators are the cross-screen navigation (the Back button is gone): clicking
		// the first indicator returns to screen 1 without closing the overlay.
		await expect(page.getByTestId("onboarding-back")).toHaveCount(0);
		await page.getByTestId("onboarding-page-0").click();
		await expect(page.getByTestId("onboarding-root")).toBeVisible();
		await expect(overlay).toBeVisible();
	});

	test("the feature carousel autoplays once through all three, then stops (no loop)", async ({
		page,
	}) => {
		await openAppFresh(page);
		await page.getByTestId("open-docs").click();
		await page.getByTestId("onboarding-next").click();

		// Starts on the first feature, then auto-advances every 5s through the second and third.
		await expect(page.getByTestId("onboarding-feature-0")).toHaveAttribute("data-active", "true");
		await expect(page.getByTestId("onboarding-feature-1")).toHaveAttribute("data-active", "true", {
			timeout: 8000,
		});
		await expect(page.getByTestId("onboarding-feature-2")).toHaveAttribute("data-active", "true", {
			timeout: 8000,
		});

		// After the third completes autoplay stops permanently — it does not loop back to the first.
		await page.waitForTimeout(6000);
		await expect(page.getByTestId("onboarding-feature-2")).toHaveAttribute("data-active", "true");
		await expect(page.getByTestId("onboarding-feature-0")).toHaveAttribute("data-active", "false");
	});
});
