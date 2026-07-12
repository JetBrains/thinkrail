import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

// The in-app OAuth login flow, driven against a **fake pi OAuth provider** (`e2e-oauth`, registered in
// dev.ts behind THINKRAIL_E2E_FAKE_OAUTH). This exercises the whole session-less login bridge end-to-end —
// provider.loginStart (detached) → frames on the `provider.login` channel → the accumulating dialog → a
// loginReply per select/prompt → success → status re-read — with no real provider or browser.

const SIGNIN = '[data-testid="provider-signin"][data-provider="e2e-oauth"]';
const CONFIGURED =
	'[data-testid="provider-row"][data-provider="e2e-oauth"][data-configured="true"]';

test("signs in through the OAuth dialog (select → open-URL + paste → success), then signs out", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	// The fake provider surfaces as an OAuth sign-in row. Start the flow.
	await page.locator(SIGNIN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute("data-provider", "e2e-oauth");

	// 1) A `select` frame — pick a method.
	await expect(page.getByTestId("login-option").first()).toBeVisible();
	await page.locator('[data-testid="login-option"][data-option="subscription"]').click();

	// 2) The browser-vs-paste state — the open-URL button and the paste field are live together.
	await expect(page.getByTestId("login-open-url")).toBeVisible();
	const codeInput = page.getByTestId("login-input");
	await expect(codeInput).toBeVisible();
	await codeInput.fill("the-auth-code");
	await page.getByTestId("login-submit").click();

	// 3) The fake returns credentials → terminal success frame.
	await expect(page.getByTestId("login-success")).toBeVisible();
	await expect(dialog).toHaveAttribute("data-status", "success");

	// Done closes the dialog; the status re-read shows the provider connected.
	await page.getByTestId("login-close").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator(CONFIGURED)).toBeVisible();

	// Sign out reverts it (auth.json credential → canLogout), leaving a clean slate for the next test.
	await page.locator('[data-testid="provider-signout"][data-provider="e2e-oauth"]').click();
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
});

test("cancelling the OAuth dialog aborts the login and leaves the provider unconfigured", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	await page.locator(SIGNIN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("login-option").first()).toBeVisible();

	// Cancel mid-flow (`provider.loginCancel`): the dialog closes and nothing is configured.
	await page.getByTestId("login-cancel").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
	// The sign-in row is still offered.
	await expect(page.locator(SIGNIN)).toBeVisible();
});
