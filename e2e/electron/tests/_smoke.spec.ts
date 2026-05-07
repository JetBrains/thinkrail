import { test, expect } from "../fixtures";
import { openProject } from "../helpers/openProject";
import { appShell } from "../../helpers/selectors";

/**
 * Smoke spec for the electron suite: launches the real Electron desktop app,
 * opens a fresh temp project from the ProjectPicker, and confirms the AppShell
 * reaches a ready state. Exercises the full production wiring:
 *
 *   - Electron main spawns the PyInstaller backend on a free port (9100–9199)
 *   - BrowserWindow loads the SPA from the spawned backend's URL
 *   - ProjectPicker → openProject → AppShell + status bar
 *
 * Filename starts with `_` so this runs first in alphabetical order — failing
 * fast before any feature spec wastes time on a broken shell.
 */
test("launches electron, opens temp project, AppShell ready", async ({
  electronApp,
  tempProject,
}) => {
  const { app, window } = electronApp;

  // Window basics: title is "Bonsai" and the renderer URL is the dynamically
  // picked backend, not a file:// or about:blank fallback.
  await expect(window).toHaveTitle("Bonsai");
  expect(window.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);

  // Project picker is the landing screen post-auth-removal.
  await openProject(window, tempProject.path);

  await expect(window.locator(appShell.statusBar)).toBeVisible();
  await expect(window.getByText(appShell.statusSessionsLabel)).toBeVisible();

  // Sanity: only one BrowserWindow exists (no orphaned popups).
  expect(app.windows()).toHaveLength(1);
});
