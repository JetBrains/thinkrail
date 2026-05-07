import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type ElectronContext = {
  app: ElectronApplication;
  window: Page;
  /** Per-test isolated Electron `userData` directory (Chromium `--user-data-dir`). */
  userDataDir: string;
  /** Per-test isolated backend data dir (`BONSAI_DATA_DIR` → AppStore SQLite, indexes). */
  backendDataDir: string;
};

export type TempProject = { path: string };

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ELECTRON_DIR = resolve(REPO_ROOT, "electron");
const BACKEND_DIR = resolve(REPO_ROOT, "packaging", "dist", "bonsai-dir");

// Electron isn't installed in e2e/node_modules; resolve the binary the
// electron/ project already has installed. The `electron` npm package's main
// export is the absolute path to its bundled platform binary.
const ELECTRON_BINARY = createRequire(`${ELECTRON_DIR}/package.json`)("electron") as string;

/**
 * Per-test Electron fixture.
 *
 * Each test launches a fresh Electron main process with:
 *   - `--user-data-dir=<tmp>` so the AppStore SQLite is empty (no recents leak)
 *   - `BONSAI_BACKEND_DIR=<repo>/packaging/dist/bonsai-dir` so the spawned
 *     PyInstaller child resolves to the rebuilt bundle (matches dev `npm run dev`).
 *
 * On test completion we close the app, which triggers the production
 * `before-quit` shutdown path (SIGTERM → 5 s grace → SIGKILL on the backend).
 */
export const test = base.extend<{
  electronApp: ElectronContext;
  tempProject: TempProject;
}>({
  electronApp: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), "bonsai-e2e-electron-userdata-"));
    const backendDataDir = mkdtempSync(join(tmpdir(), "bonsai-e2e-electron-data-"));
    const app = await electron.launch({
      executablePath: ELECTRON_BINARY,
      args: [ELECTRON_DIR, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        BONSAI_BACKEND_DIR: BACKEND_DIR,
        // Per-test backend data dir → fresh AppStore SQLite, no recents leak,
        // no contention with the developer's real ~/.bonsai/.
        BONSAI_DATA_DIR: backendDataDir,
      },
      timeout: 60_000,
    });
    const window = await app.firstWindow();
    try {
      await use({ app, window, userDataDir, backendDataDir });
    } finally {
      try {
        await app.close();
      } catch {
        // already closed by the spec — ignore
      }
      for (const dir of [userDataDir, backendDataDir]) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  },

  tempProject: async ({}, use) => {
    const path = mkdtempSync(join(tmpdir(), "bonsai-e2e-electron-"));
    try {
      await use({ path });
    } finally {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // ignore — must not fail teardown
      }
    }
  },
});

export { expect } from "@playwright/test";
