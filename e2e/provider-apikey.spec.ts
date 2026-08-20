import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

const APIKEY_BTN = '[data-testid="provider-apikey"][data-provider="e2e-apikey"]';
const CONFIGURED =
	'[data-testid="provider-row"][data-provider="e2e-apikey"][data-configured="true"]';

test("configures a provider by API key through the login dialog (secret prompt → success)", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	await expect(page.getByTestId("provider-apikey").first()).toBeVisible();
	const showMore = page.getByTestId("providers-show-more");
	if (await showMore.isVisible()) await showMore.click();
	await page.locator(APIKEY_BTN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute("data-provider", "e2e-apikey");

	const input = page.getByTestId("login-input");
	await expect(input).toBeVisible();
	await expect(input).toHaveAttribute("type", "password");
	await input.fill("e2e-super-secret");
	await page.getByTestId("login-submit").click();

	await expect(page.getByTestId("login-success")).toBeVisible();
	await page.getByTestId("login-close").click();
	await expect(dialog).toHaveCount(0);

	await expect(page.locator(CONFIGURED)).toBeVisible();

	await page.locator('[data-testid="provider-signout"][data-provider="e2e-apikey"]').click();
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
	await expect(page.locator(APIKEY_BTN)).toBeVisible();
});

test("the OAuth-only fake offers no API-key entry (flags derive from Provider.auth alone)", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	await expect(
		page.locator('[data-testid="provider-signin"][data-provider="e2e-oauth"]'),
	).toBeVisible();
	await expect(
		page.locator('[data-testid="provider-apikey"][data-provider="e2e-oauth"]'),
	).toHaveCount(0);
});
