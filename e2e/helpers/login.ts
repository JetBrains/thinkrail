import { expect, type Page } from "@playwright/test";
import { appShell, loginScreen, projectPicker } from "./selectors";

export async function loginAs(page: Page, token: string): Promise<void> {
  if (page.url() === "about:blank") {
    await page.goto("/");
  }
  await page.locator(loginScreen.tokenInput).fill(token);
  await page.getByRole(loginScreen.submitButton.role, { name: loginScreen.submitButton.name }).click();
  // Login dismisses the screen — wait for the path input (project picker) to
  // confirm. Token validation hits `/api/user/profile`, which can be slow on
  // a heavily-loaded dev backend (see the ProjectSettings reload paths), so
  // we give it more headroom than the default 15s expect timeout.
  await expect(page.locator(projectPicker.pathInput)).toBeVisible({ timeout: 30_000 });
}

/**
 * Submit the LoginScreen with `token` and assert that an error appears
 * (i.e. the login is rejected and we stay on the form).
 */
export async function loginAsExpectingError(page: Page, token: string): Promise<void> {
  if (page.url() === "about:blank") {
    await page.goto("/");
  }
  await page.locator(loginScreen.tokenInput).fill(token);
  await page.getByRole(loginScreen.submitButton.role, { name: loginScreen.submitButton.name }).click();
  await expect(page.locator(loginScreen.errorMessage)).toBeVisible();
  // Picker must NOT be visible — login failed.
  await expect(page.locator(projectPicker.pathInput)).toHaveCount(0);
}

/**
 * Inject `token` directly into localStorage and navigate to `/`. This forces
 * the app's initial load path (Root component) to fetch the user profile and
 * correctly populate the `isAdmin` flag in the token store — something the
 * LoginScreen alone does not do until the next page load.
 *
 * Use this when a test needs accurate role-based UI (Admin button, etc.) on
 * its very first page visit; otherwise prefer `loginAs`, which exercises the
 * real login form.
 */
export async function loginViaToken(page: Page, token: string): Promise<void> {
  // We must visit a page on the same origin before touching localStorage.
  await page.goto("/");
  await page.evaluate((t) => {
    localStorage.setItem("bonsai_token", t);
  }, token);
  await page.goto("/");
  // Project picker is the post-login landing for an authenticated user.
  // Root.useEffect runs getSetupStatus() then getUserProfile() sequentially
  // before rendering the picker, so allow the same 30s headroom as loginAs.
  await expect(page.locator(projectPicker.pathInput)).toBeVisible({ timeout: 30_000 });
}

/**
 * Open the project at `path`. Auto-inits a fresh project if needed.
 * Resolves once the AppShell is ready (status bar visible).
 */
export async function openProject(page: Page, path: string): Promise<void> {
  const pathInput = page.locator(projectPicker.pathInput);
  await expect(pathInput).toBeVisible();
  await pathInput.fill(path);
  // The autocomplete popover overlaps the Open Project button — dismiss it.
  await page.keyboard.press("Escape");
  await page.getByRole(projectPicker.openButton.role, { name: projectPicker.openButton.name }).click();
  // The AppShell is "ready" once the status bar shows the session count.
  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible({ timeout: 30_000 });
}
