import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";
import { seedConfig } from "./fixtures/config";
import { E2E_DATA_DIR } from "./fixtures/paths";

// The first-run onboarding overlay: a large card floating over the still-visible IDE. It auto-opens once
// (gated on the host-synced `AppConfig.onboarding.introSeenAt`), blocks dismissal on first run, and is
// re-openable from the left-panel help button in a dismissible "review" mode. `resetState` seeds a
// pre-seen config so the blocking overlay never covers the rest of the suite; the first-run tests below
// flip the host to a virgin config (write `config.json` + reload) to exercise auto-open + legacy migration.

function configOnDisk(): { onboarding?: { introSeenAt?: string } } {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "config.json"), "utf8"));
}

/** Reset, then flip the host to a virgin (never-onboarded) config and reload so welcome re-reads it. */
async function openAppVirgin(page: import("@playwright/test").Page): Promise<void> {
	await openAppFresh(page);
	seedConfig({ theme: "dark" });
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

test.describe("onboarding first run", () => {
	test("auto-opens on a virgin config, blocks Escape, and finishing persists host-side", async ({
		page,
	}) => {
		await openAppVirgin(page);
		const overlay = page.getByTestId("onboarding");
		await expect(overlay).toBeVisible();
		await expect(page.getByTestId("shell")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(overlay).toBeVisible();

		await page.getByTestId("onboarding-next").click();
		await page.getByTestId("onboarding-done").click();
		await expect(overlay).toBeHidden();

		// The seen-flag landed in the HOST's config.json (not this device) …
		await expect.poll(() => configOnDisk().onboarding?.introSeenAt).toBeTruthy();
		// … so a reload (fresh client state) does not re-open the overlay.
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(page.getByTestId("onboarding")).toHaveCount(0);
	});

	test("a device that saw the localStorage-era onboarding is migrated, not re-nagged", async ({
		page,
	}) => {
		await openAppFresh(page);
		await page.evaluate(() => localStorage.setItem("thinkrail:onboardingSeen", "true"));
		seedConfig({ theme: "dark" });
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

		// No overlay — and the legacy flag folded into host config, then cleared from the device.
		await expect(page.getByTestId("onboarding")).toHaveCount(0);
		await expect.poll(() => configOnDisk().onboarding?.introSeenAt).toBeTruthy();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("thinkrail:onboardingSeen")))
			.toBeNull();
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

test.describe("worktree game", () => {
	test("plays five beats deterministically to 5/5 and finishes", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" }); // instant reveals — stable assertions
		await openAppFresh(page);
		await page.getByTestId("open-docs").click();
		await page.getByTestId("onboarding-next").click();
		await page.getByTestId("onboarding-play").click();
		await expect(page.getByTestId("onboarding-game")).toBeVisible();

		// Beat 1 (tap): exactly the committed files.
		for (const path of ["src/app.ts", "src/tuner.ts", "README.md"]) {
			await page.getByTestId(`game-chip-${path}`).click();
		}
		await page.getByTestId("game-reveal").click();
		await expect(page.getByTestId("game-whyline")).toContainText("starts from a commit");
		await expect(page.getByTestId(`game-chip-.env`)).toContainText("stays here");
		await page.getByTestId("game-next").click();

		// Beats 2-5 (choices): pick the correct answer each time.
		for (const correct of ["own", "fails", "yes", "workspace"]) {
			await page.getByTestId(`game-choice-${correct}`).click();
			await page.getByTestId("game-reveal").click();
			await page.getByTestId("game-next").click();
		}

		await expect(page.getByTestId("game-score")).toContainText("5 / 5");
		await page.getByTestId("game-finish").click();
		await expect(page.getByTestId("onboarding")).toBeHidden();
	});

	test("skip returns to the carousel, never dismissing the overlay", async ({ page }) => {
		await openAppFresh(page);
		await page.getByTestId("open-docs").click();
		await page.getByTestId("onboarding-next").click();
		await page.getByTestId("onboarding-play").click();
		await page.getByTestId("game-skip").click();
		await expect(page.getByTestId("onboarding-feature-0")).toBeVisible();
		await expect(page.getByTestId("onboarding")).toBeVisible();
	});
});
