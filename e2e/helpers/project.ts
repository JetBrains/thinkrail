import { expect, type Page } from "@playwright/test";
import { appShell, projectPicker } from "./selectors";

/**
 * Open the project at `path`. Auto-inits a fresh project if needed.
 * Resolves once the AppShell is ready (status bar visible).
 *
 * Bonsai is single-user / localhost-only — no auth, no token, no login screen.
 * The app boots straight to ProjectPicker.
 */
export async function openProject(page: Page, path: string): Promise<void> {
  if (page.url() === "about:blank") {
    await page.goto("/");
  }
  const pathInput = page.locator(projectPicker.pathInput);
  await expect(pathInput).toBeVisible();
  await pathInput.fill(path);
  // The autocomplete popover overlaps the Open Project button — dismiss it.
  await page.keyboard.press("Escape");
  await page.getByRole(projectPicker.openButton.role, { name: projectPicker.openButton.name }).click();
  // The AppShell is "ready" once the status bar shows the session count.
  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible({ timeout: 30_000 });
}
