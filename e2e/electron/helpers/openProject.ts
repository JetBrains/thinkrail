import { expect, type Page } from "@playwright/test";
import { appShell, projectPicker } from "../../helpers/selectors";

/**
 * Open the project at `path` from inside the Electron BrowserWindow.
 * Mirrors the web `helpers/project.ts` flow but operates on the Electron
 * window page returned by `_electron.launch().firstWindow()`.
 *
 * The same React SPA renders inside the BrowserWindow as in dev — the central
 * `helpers/selectors.ts` selectors apply unchanged.
 */
export async function openProject(window: Page, path: string): Promise<void> {
  // Cold-start: backend takes a few seconds to bind the port. The window may
  // briefly render did-fail-load before the SPA loads.
  await window.waitForSelector(".picker-card", { timeout: 30_000 });

  const pathInput = window.locator(projectPicker.pathInput);
  await expect(pathInput).toBeVisible();
  await pathInput.fill(path);
  // Autocomplete popover overlaps the Open Project button — dismiss it.
  await window.keyboard.press("Escape");
  await window
    .getByRole(projectPicker.openButton.role, { name: projectPicker.openButton.name })
    .click();

  // AppShell is "ready" once the status bar shows the session count, same
  // signal the web suite uses.
  await expect(window.getByText(appShell.statusSessionsLabel)).toBeVisible({
    timeout: 30_000,
  });
}
