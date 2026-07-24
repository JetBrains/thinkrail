import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

// The in-app API-key setup flow (issue #97), driven against a **fake native pi provider**
// (`e2e-apikey`, registered in dev.ts behind THINKRAIL_E2E_FAKE_OAUTH). API-key entry rides the SAME
// session-less login bridge as OAuth — provider.loginStart {type:"api_key"} (detached) → the
// provider-owned secret prompt as a frame on `provider.login` → the dialog's masked input → loginReply →
// pi persists to auth.json → success → status re-read — no inline key field, no provider-specific code.

const APIKEY_BTN = '[data-testid="provider-apikey"][data-provider="e2e-apikey"]';
const CONFIGURED =
	'[data-testid="provider-row"][data-provider="e2e-apikey"][data-configured="true"]';

test("configures a provider by API key through the login dialog (secret prompt → success)", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	// The fake surfaces as an unconfigured row offering "API key" (it has no OAuth). With every builtin
	// provider now canApiKey (#97), the key group is capped — wait for the rows, expand, then target it.
	await expect(page.getByTestId("provider-apikey").first()).toBeVisible();
	const showMore = page.getByTestId("providers-show-more");
	if (await showMore.isVisible()) await showMore.click();
	await page.locator(APIKEY_BTN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute("data-provider", "e2e-apikey");

	// The provider-owned `secret` prompt arrives as a frame; the dialog masks the input (#97).
	const input = page.getByTestId("login-input");
	await expect(input).toBeVisible();
	await expect(input).toHaveAttribute("type", "password");
	await input.fill("e2e-super-secret");
	await page.getByTestId("login-submit").click();

	// pi stored the credential (auth.json) → terminal success frame.
	await expect(page.getByTestId("login-success")).toBeVisible();
	await page.getByTestId("login-close").click();
	await expect(dialog).toHaveCount(0);

	// The status re-read shows the provider connected via api-key; auth.json credential → Sign out shown.
	await expect(page.locator(CONFIGURED)).toBeVisible();

	// Sign out reverts it, leaving a clean slate for other tests.
	await page.locator('[data-testid="provider-signout"][data-provider="e2e-apikey"]').click();
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
	await expect(page.locator(APIKEY_BTN)).toBeVisible();
});

test("the OAuth-only fake offers no API-key entry (flags derive from Provider.auth alone)", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	// e2e-oauth registers only an `oauth` method (like openai-codex among the builtins): Sign in is
	// offered, API key is not — `canApiKey` is pi's `Provider.auth.apiKey.login` truth, nothing else.
	await expect(
		page.locator('[data-testid="provider-signin"][data-provider="e2e-oauth"]'),
	).toBeVisible();
	await expect(
		page.locator('[data-testid="provider-apikey"][data-provider="e2e-oauth"]'),
	).toHaveCount(0);
});
