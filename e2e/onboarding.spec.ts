import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

// The onboarding overlay. The suite globally pre-seeds `thinkrail:onboardingSeen=true` (playwright.config
// `use.storageState`), so first-run doesn't block every other test; the first-run test below clears it.

test.describe("first run (no seen flag)", () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test("auto-opens a blocking onboarding; root approval gates step 1; finishing closes it", async ({
		page,
	}) => {
		await openAppFresh(page);

		const onboarding = page.getByTestId("onboarding");
		await expect(onboarding).toBeVisible();

		// Blocking: Escape does not dismiss it (no skip/close on first run).
		await page.keyboard.press("Escape");
		await expect(onboarding).toBeVisible();

		// Step 1 = Welcome + root path (label reads "Worktrees are saved in").
		await expect(page.getByTestId("onboarding-root")).toContainText(".thinkrail/worktrees");
		await expect(page.getByTestId("onboarding")).toContainText("Worktrees are saved in");

		// Step through the feature explainers to the final step, then finish.
		await page.getByTestId("onboarding-next").click();
		await page.getByTestId("onboarding-next").click();
		await page.getByTestId("onboarding-next").click();
		await expect(page.getByTestId("onboarding-done")).toBeVisible();
		await page.getByTestId("onboarding-done").click();
		await expect(onboarding).toHaveCount(0);
	});
});

test("the left-panel help button re-opens onboarding in a closable review mode", async ({
	page,
}) => {
	// Default seeded storage → past first-run, so nothing auto-blocks.
	await openAppFresh(page);
	await expect(page.getByTestId("onboarding")).toHaveCount(0);

	await page.getByTestId("open-docs").click();
	const onboarding = page.getByTestId("onboarding");
	await expect(onboarding).toBeVisible();

	// Re-opened (review) mode is closable — Escape dismisses it.
	await page.keyboard.press("Escape");
	await expect(onboarding).toHaveCount(0);
});

test("the worktree help popover explains the concept without closing onboarding", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-docs").click();
	const onboarding = page.getByTestId("onboarding");
	await expect(onboarding).toBeVisible();

	// The inline help after "worktree" opens a short explanation…
	await page.getByTestId("worktree-help").click();
	await expect(page.getByText("its own branch and its own directory on disk")).toBeVisible();
	// …and clicking it does not dismiss the onboarding overlay.
	await expect(onboarding).toBeVisible();
});
