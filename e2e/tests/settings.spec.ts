import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedProject } from "../helpers/specs";
import { fileViewer, header } from "../helpers/selectors";

/**
 * Project settings smoke.
 *
 * The header gear button opens `.bonsai/settings.json` in the FileViewer.
 * The settings file's defaults match the backend `ProjectSettings` model.
 *
 * Editing the settings JSON via the Monaco editor is fiddly under Playwright,
 * so we exercise persistence by writing the file directly on disk and
 * verifying the backend serves the updated value.
 *
 * Bonsai is single-user / localhost-only — there's no per-user preferences
 * sync, no `/api/user/*` endpoints, no token. Per-project UI state (theme,
 * panel collapse, font size, message history) lives in the frontend's
 * `bonsai-*` localStorage keys.
 */

test.describe("Project settings", () => {
  test("gear button opens settings.json with default fields visible", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    await openProject(page, tempProject.path);

    await page.locator(header.settingsButton).click();

    // FileViewer takes over the center pane and displays settings.json.
    // The click chains a WS RPC (`settings/ensureFile`) plus a REST GET
    // (`/api/file/read`); both can be slow on a heavily-loaded backend.
    await expect(page.locator(fileViewer.root)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(fileViewer.path)).toContainText(
      ".bonsai/settings.json",
    );

    // Backend wrote the file with defaults — assert it exists on disk.
    const settingsPath = join(
      tempProject.path,
      ".bonsai",
      "settings.json",
    );
    await expect
      .poll(() => existsSync(settingsPath), { timeout: 15_000 })
      .toBe(true);

    // Default values cover the project-scoped settings that remain in
    // ProjectSettings. Session-creation defaults (model / effort /
    // permission_mode / max_turns) live elsewhere — they're user-scoped
    // in the AppStore — so they intentionally do *not* appear here.
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("font_size");
    expect(parsed).toHaveProperty("voice_revise_mode");
    expect(parsed).not.toHaveProperty("default_model");

    // Monaco renders the JSON content too.
    await expect(page.locator(fileViewer.monacoViewLines).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("settings.json edits on disk are picked up after reload", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    // Pre-seed a non-default project-scoped settings file. Session
    // defaults aren't in this file anymore (user-scope, AppStore-backed) —
    // use a project-scoped field to verify load + render.
    const settingsPath = join(
      tempProject.path,
      ".bonsai",
      "settings.json",
    );
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          font_size: 17,
          compact_font_size: 11,
          voice_revise_mode: "auto",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await openProject(page, tempProject.path);

    // Open the file via the gear and assert the seeded values render.
    await page.locator(header.settingsButton).click();
    await expect(page.locator(fileViewer.root)).toBeVisible({ timeout: 30_000 });
    const monacoText = page.locator(`${fileViewer.root} .monaco-editor`);
    await expect(monacoText).toContainText("\"font_size\": 17", {
      timeout: 30_000,
    });
    await expect(monacoText).toContainText("\"voice_revise_mode\": \"auto\"");
  });
});

test.describe("UI preferences", () => {
  test("collapsed left panel persists across reload via localStorage", async ({
    page,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    await openProject(page, tempProject.path);

    // The LeftPanel is part of `.layout` and is visible by default. Toggle
    // it off via the keyboard shortcut (Alt+B).
    const leftPanelLocator = page.locator(".left-panel");
    await expect(leftPanelLocator).toBeVisible();

    // Empty projects auto-focus the welcome textarea; global shortcuts are
    // intentionally ignored while text input is focused.
    await page.locator(header.logo).click();
    await page.keyboard.press("Alt+b");
    await expect(leftPanelLocator).toHaveCount(0);

    // Per-user prefs are not server-synced (Bonsai is single-user / localhost-
    // only). The UI store persists `leftPanelCollapsed` to localStorage under
    // "bonsai-ui"; that's the source of truth across reloads.
    await page.reload();
    await expect(page.locator(".status-bar")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".left-panel")).toHaveCount(0, { timeout: 30_000 });

    // Toggle it back on so the next reload doesn't carry over to other tests.
    await page.locator(header.logo).click();
    await page.keyboard.press("Alt+b");
    await expect(page.locator(".left-panel")).toBeVisible({ timeout: 15_000 });
  });
});
