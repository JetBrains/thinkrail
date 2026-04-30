import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { loginAs, openProject } from "../helpers/login";
import { seedProject } from "../helpers/specs";
import { fileViewer, header } from "../helpers/selectors";

/**
 * Project settings + user preferences smoke.
 *
 * - The header gear button opens `.bonsai/settings.json` in the FileViewer.
 *   The settings file's defaults match the backend `ProjectSettings` model.
 * - User preferences (left panel collapsed, etc.) sync through
 *   `user/updatePreferences` and are restored on next page load.
 *
 * Editing the settings JSON via the Monaco editor is fiddly under Playwright,
 * so we exercise persistence by writing the file directly on disk and
 * verifying the backend serves the updated value.
 */

// Settings specs hit the auth-protected `/api/user/profile` endpoint twice
// (once on initial login, once after reload), and that endpoint can be slow
// on a heavily-loaded dev backend — give them extra headroom.
test.describe.configure({ timeout: 180_000 });

test.describe("Project settings", () => {
  test("gear button opens settings.json with default fields visible", async ({
    page,
    admin,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    await loginAs(page, admin.token);
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

    // Default values must include `default_model` and `default_effort`.
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("default_model");
    expect(parsed).toHaveProperty("default_effort");
    expect(parsed).toHaveProperty("font_size");

    // Monaco renders the JSON content too.
    await expect(page.locator(fileViewer.monacoViewLines).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("settings.json edits on disk are picked up after reload", async ({
    page,
    admin,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    // Pre-seed an explicit non-default settings file before opening the
    // project, so the backend's `settings/get` returns the custom value.
    const settingsPath = join(
      tempProject.path,
      ".bonsai",
      "settings.json",
    );
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          default_model: "claude-haiku-4-5",
          default_effort: "low",
          font_size: 17,
          compact_font_size: 11,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await loginAs(page, admin.token);
    await openProject(page, tempProject.path);

    // Open the file via the gear and assert the seeded values render.
    await page.locator(header.settingsButton).click();
    await expect(page.locator(fileViewer.root)).toBeVisible({ timeout: 30_000 });
    const monacoText = page.locator(`${fileViewer.root} .monaco-editor`);
    await expect(monacoText).toContainText("claude-haiku-4-5", {
      timeout: 30_000,
    });
    await expect(monacoText).toContainText("\"font_size\": 17");
  });
});

test.describe("User preferences", () => {
  test("collapsed left panel persists across reload", async ({
    page,
    admin,
    tempProject,
  }) => {
    seedProject(tempProject.path, []);

    // Set up a WS-frame matcher BEFORE navigating so we catch the WS that
    // login/openProject opens. `syncPref` fires `user/updatePreferences` as
    // a best-effort, fire-and-forget JSON-RPC request — we capture the
    // outgoing request id and resolve when its response lands. A fixed sleep
    // here is racy on a loaded backend.
    //
    // Filter on the patch *content*, not just the method: `App.tsx` calls
    // `applyTheme()` during initial preference hydration, which echoes a
    // `syncPref({ theme })` over the same RPC. If that hydration lands after
    // we arm, an unrelated theme echo would otherwise resolve `updatePrefsAck`
    // before the `Alt+b` left-panel patch commits, reopening the reload race.
    let armed = false;
    const pendingIds = new Set<number>();
    let resolveAck: () => void = () => {};
    const updatePrefsAck = new Promise<void>((resolve) => {
      resolveAck = resolve;
    });
    const decode = (data: { payload: string | Buffer }): string =>
      typeof data.payload === "string" ? data.payload : data.payload.toString("utf8");
    page.on("websocket", (ws) => {
      ws.on("framesent", (data) => {
        if (!armed) return;
        try {
          const msg = JSON.parse(decode(data));
          if (
            msg.method === "user/updatePreferences" &&
            typeof msg.id === "number" &&
            msg.params &&
            typeof msg.params === "object" &&
            msg.params.patch &&
            typeof msg.params.patch === "object" &&
            "leftPanelCollapsed" in msg.params.patch
          ) {
            pendingIds.add(msg.id);
          }
        } catch {
          // not a JSON-RPC frame
        }
      });
      ws.on("framereceived", (data) => {
        try {
          const msg = JSON.parse(decode(data));
          if (
            typeof msg.id === "number" &&
            pendingIds.has(msg.id) &&
            (msg.result !== undefined || msg.error !== undefined)
          ) {
            resolveAck();
          }
        } catch {
          // not a JSON-RPC frame
        }
      });
    });

    await loginAs(page, admin.token);
    await openProject(page, tempProject.path);

    // The LeftPanel is part of `.layout` and is visible by default. Toggle
    // it off via the keyboard shortcut (Cmd/Ctrl + B).
    const leftPanelLocator = page.locator(".left-panel");
    await expect(leftPanelLocator).toBeVisible();

    armed = true;
    await page.keyboard.press("Alt+b");
    await expect(leftPanelLocator).toHaveCount(0);

    // Wait for the actual `user/updatePreferences` response — a fire-and-
    // forget sleep can let the reload below beat the backend commit on a
    // loaded box.
    await Promise.race([
      updatePrefsAck,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("user/updatePreferences ack not seen within 30s")),
          30_000,
        ),
      ),
    ]);

    // Wipe the Zustand persist key so the post-reload `leftPanelCollapsed`
    // value can ONLY come from the backend `user/getPreferences` round-trip.
    // Without this, the assertion below would pass purely from local hydration
    // (uiStore persists `leftPanelCollapsed` to localStorage under
    // "bonsai-ui"), masking a broken backend pref endpoint.
    await page.evaluate(() => {
      localStorage.removeItem("bonsai-ui");
    });

    await page.reload();
    await expect(page.locator(".status-bar")).toBeVisible({ timeout: 60_000 });
    // After reload + cleared persist cache, the LeftPanel renders briefly
    // (default state is uncollapsed). Once the WS connects and
    // `user/getPreferences` returns the saved `leftPanelCollapsed: true`,
    // the panel is hidden again — proves the backend round-trip.
    await expect(page.locator(".left-panel")).toHaveCount(0, { timeout: 30_000 });

    // Toggle it back on so the next reload doesn't carry over to other tests.
    await page.keyboard.press("Alt+b");
    await expect(page.locator(".left-panel")).toBeVisible({ timeout: 15_000 });
  });
});
