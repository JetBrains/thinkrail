import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

const SIGNIN = '[data-testid="provider-signin"][data-provider="e2e-oauth"]';
const CONFIGURED =
	'[data-testid="provider-row"][data-provider="e2e-oauth"][data-configured="true"]';

test("signs in through the OAuth dialog (select → open-URL + paste → success), then signs out", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	await page.locator(SIGNIN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute("data-provider", "e2e-oauth");

	await expect(page.getByTestId("login-option").first()).toBeVisible();
	await page.locator('[data-testid="login-option"][data-option="subscription"]').click();

	await expect(page.getByTestId("login-open-url")).toBeVisible();
	const codeInput = page.getByTestId("login-input");
	await expect(codeInput).toBeVisible();
	await codeInput.fill("the-auth-code");
	await page.getByTestId("login-submit").click();

	await expect(page.getByTestId("login-success")).toBeVisible();
	await expect(dialog).toHaveAttribute("data-status", "success");

	await page.getByTestId("login-close").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator(CONFIGURED)).toBeVisible();

	await page.locator('[data-testid="provider-signout"][data-provider="e2e-oauth"]').click();
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
});

test("cancelling the OAuth dialog aborts the login and leaves the provider unconfigured", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	await page.locator(SIGNIN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("login-option").first()).toBeVisible();

	await page.getByTestId("login-cancel").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
	await expect(page.locator(SIGNIN)).toBeVisible();
});
