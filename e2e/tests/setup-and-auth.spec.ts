import { test, expect } from "../fixtures";
import { loginAs, loginAsExpectingError } from "../helpers/login";
import { loginScreen, projectPicker, setupScreen } from "../helpers/selectors";

/**
 * SetupScreen + LoginScreen coverage.
 *
 * SetupScreen only renders when the backend reports needsSetup=true. Since the
 * backend already has users (the admin fixture itself creates them), we can't
 * reach that state in a real run. Instead we mock the /api/setup endpoints at
 * the network layer — this exercises the real React component without
 * touching the live database.
 */

test.describe("LoginScreen", () => {
  test("valid token logs the user in and shows the project picker", async ({ page, admin }) => {
    await loginAs(page, admin.token);
    await expect(page.locator(projectPicker.pathInput)).toBeVisible();
  });

  test("invalid token shows an error and keeps the user on the form", async ({ page }) => {
    await loginAsExpectingError(page, "bns_definitely_not_a_real_token_zzz");
    await expect(page.locator(loginScreen.errorMessage)).toContainText(/Invalid token|Could not reach/);
  });
});

test.describe("SetupScreen", () => {
  test("first-user setup form renders, accepts input, and shows the new token", async ({ page }) => {
    const fakeToken = "bns_e2e_fake_setup_token";

    // Force needsSetup=true regardless of real backend state.
    await page.route("**/api/setup/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ needsSetup: true }),
      });
    });

    // Catch the POST and return a synthetic SetupResponse.
    await page.route("**/api/setup", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            userId: "e2e_admin",
            displayName: "E2E Admin",
            token: fakeToken,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/");

    // Form is visible.
    const userIdInput = page.locator(setupScreen.userIdInput);
    const nameInput = page.locator(setupScreen.nameInput);
    await expect(userIdInput).toBeVisible();
    await expect(nameInput).toBeVisible();

    await userIdInput.fill("e2e_admin");
    await nameInput.fill("E2E Admin");
    await page.getByRole(setupScreen.submitButton.role, { name: setupScreen.submitButton.name }).click();

    // Success view: token is displayed verbatim so the user can copy it.
    await expect(page.getByText(setupScreen.successSubtitle)).toBeVisible();
    await expect(page.locator(setupScreen.tokenValue)).toHaveText(fakeToken);

    // Continue button is wired up; clicking it dismisses the SetupScreen
    // and lands the user on the project picker (the App took the token).
    await page.getByRole(setupScreen.continueButton.role, { name: setupScreen.continueButton.name }).click();
    // After clicking Continue, either the picker or LoginScreen shows up
    // (the synthetic token will fail real backend checks); we just assert
    // the SetupScreen is gone.
    await expect(page.locator(setupScreen.userIdInput)).toHaveCount(0);
  });
});
