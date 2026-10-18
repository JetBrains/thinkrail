import { expect, type Page, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

const SIGNIN = '[data-testid="provider-signin"][data-provider="e2e-oauth"]';
const CONFIGURED =
	'[data-testid="provider-row"][data-provider="e2e-oauth"][data-configured="true"]';
const SIGNOUT = '[data-testid="provider-signout"][data-provider="e2e-oauth"]';
const LOOPBACK_URL =
	"https://e2e.test/authorize?probe=1&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fcallback";

async function startLogin(page: Page, option: "subscription" | "api") {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();
	await page.locator(SIGNIN).click();
	const dialog = page.getByTestId("login-dialog");
	await expect(dialog).toBeVisible();
	await page.locator(`[data-testid="login-option"][data-option="${option}"]`).click();
	return dialog;
}

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

	await expect(page.getByRole("link", { name: "Open sign-in page" })).toHaveAttribute(
		"href",
		LOOPBACK_URL,
	);
	await expect(page.getByTestId("login-copy-url")).toBeVisible();
	await expect(dialog).not.toContainText("e2e.test/authorize");
	await expect(page.getByTestId("login-progress")).toHaveText(
		"Waiting for you to finish signing in…",
	);
	await expect(page.getByTestId("login-input")).toHaveCount(0);
	await page.getByTestId("login-paste-toggle").click();
	await expect(page.getByTestId("login-paste-hint")).toBeVisible();
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

test("a copy-code sign-in shows its required prompt right away and completes", {
	tag: "@dev-seam",
}, async ({ page }) => {
	const dialog = await startLogin(page, "api");

	const codeInput = page.getByTestId("login-input");
	await expect(codeInput).toBeVisible();
	await expect(dialog).toContainText("Paste the code E2E shows after you sign in:");
	await expect(page.getByTestId("login-paste-toggle")).toHaveCount(0);
	await expect(page.getByTestId("login-paste-hint")).toHaveCount(0);
	await expect(page.getByTestId("login-progress")).toHaveCount(0);

	await codeInput.fill("copied-code");
	await page.getByTestId("login-submit").click();
	await expect(page.getByTestId("login-success")).toBeVisible();
	await page.getByTestId("login-close").click();
	await page.locator(SIGNOUT).click();
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
});

test("when the clipboard is unavailable, Copy link reveals a selected manual-copy field", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: () => Promise.reject(new Error("denied")) },
		});
	});
	const dialog = await startLogin(page, "subscription");

	await expect(page.getByTestId("login-url-field")).toHaveCount(0);
	await page.getByTestId("login-copy-url").click();
	const field = page.getByRole("textbox", { name: "Copy this link manually" });
	await expect(field).toHaveValue(LOOPBACK_URL);
	await expect(field).toBeFocused();
	expect(
		await field.evaluate(
			(el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length,
		),
	).toBe(true);

	await page.getByTestId("login-paste-toggle").click();
	await page.getByTestId("login-input").fill("the-auth-code");
	await page.getByTestId("login-submit").click();
	await expect(dialog).toHaveAttribute("data-status", "success");
	await page.getByTestId("login-close").click();
	await page.locator(SIGNOUT).click();
	await expect(page.locator(CONFIGURED)).toHaveCount(0);
});
