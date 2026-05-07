import { _electron as electron, expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startSessionConnectivityCheck } from "../../helpers/session";
import { appShell, chatStream, projectPicker } from "../../helpers/selectors";

/**
 * Regression spec for the per-app dotenv fallback in `credentials.ts`.
 *
 * The primary credential path is `shellEnv.ts`, which spawns the user's
 * login shell at startup and imports its env into process.env. This spec
 * covers the *fallback* path for users on shells we can't import (tcsh,
 * nushell, ...) or who want to scope the key to Bonsai instead of system-
 * wide: a `<dataDir>/.env` file with `ANTHROPIC_API_KEY=...`.
 *
 * To exercise the dotenv branch deterministically we:
 *   1. Strip `ANTHROPIC_API_KEY` from the launched env.
 *   2. Set `BONSAI_NO_SHELL_ENV=1` so `shellEnv.ts` short-circuits — without
 *      this the test would non-hermetically pick up the runner's own
 *      `~/.zshrc` exports and the dotenv branch would never run.
 *   3. Seed `<dataDir>/.env` with the key.
 *
 * A green test means `credentials.ts` resolved the key from the .env file
 * and forwarded it to the spawned backend.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ELECTRON_DIR = resolve(REPO_ROOT, "electron");
const BACKEND_DIR = resolve(REPO_ROOT, "packaging", "dist", "bonsai-dir");
const ELECTRON_BINARY = createRequire(`${ELECTRON_DIR}/package.json`)(
  "electron",
) as string;

test("starts a session when ANTHROPIC_API_KEY lives in <dataDir>/.env (Finder launch path)", async () => {
  const realKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  test.skip(
    realKey === "",
    "ANTHROPIC_API_KEY must be set in the test runner env to seed <dataDir>/.env",
  );

  const userDataDir = mkdtempSync(join(tmpdir(), "bonsai-e2e-finder-ud-"));
  const backendDataDir = mkdtempSync(join(tmpdir(), "bonsai-e2e-finder-data-"));
  const tempProjectPath = mkdtempSync(join(tmpdir(), "bonsai-e2e-finder-proj-"));

  try {
    // Seed `<dataDir>/.env` so the Electron main process can resolve the key
    // even though we strip it from process.env below. Mirrors what a user
    // would do once: `echo ANTHROPIC_API_KEY=sk-ant-... > ~/.bonsai/.env`.
    writeFileSync(join(backendDataDir, ".env"), `ANTHROPIC_API_KEY=${realKey}\n`);

    // Mimic launchd / Finder launch: minimal PATH, no inherited credentials.
    // BONSAI_NO_SHELL_ENV=1 disables shellEnv.ts's login-shell import so we
    // exercise the dotenv branch in credentials.ts specifically (otherwise
    // the runner's ~/.zshrc would supply the key and this test would pass
    // for the wrong reason).
    const minimalEnv = {
      HOME: process.env.HOME!,
      USER: process.env.USER!,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      BONSAI_BACKEND_DIR: BACKEND_DIR,
      BONSAI_DATA_DIR: backendDataDir,
      BONSAI_NO_SHELL_ENV: "1",
    };

    const app = await electron.launch({
      executablePath: ELECTRON_BINARY,
      args: [ELECTRON_DIR, `--user-data-dir=${userDataDir}`],
      env: minimalEnv,
      timeout: 60_000,
    });
    const window = await app.firstWindow();

    try {
      // Drive the same flow the user describes: open project, start a session,
      // assert no error banner. Helpers from the shared web suite work because
      // the SPA renders identically inside the BrowserWindow.
      await window.waitForSelector(".picker-card", { timeout: 30_000 });
      await window.locator(projectPicker.pathInput).fill(tempProjectPath);
      await window.keyboard.press("Escape");
      await window
        .getByRole(projectPicker.openButton.role, {
          name: projectPicker.openButton.name,
        })
        .click();
      await expect(window.getByText(appShell.statusSessionsLabel)).toBeVisible({
        timeout: 30_000,
      });

      await startSessionConnectivityCheck(window, { label: "Haiku 4.5" });

      const errorBanner = window.locator(chatStream.errorBanner);
      const sessionActivity = window.locator(chatStream.activitySelectors);
      await expect
        .poll(
          async () =>
            (await errorBanner.count()) > 0 ||
            (await sessionActivity.count()) > 0,
          {
            timeout: 90_000,
            message: "no error banner and no session activity within timeout",
          },
        )
        .toBe(true);

      if ((await errorBanner.count()) > 0) {
        const text = (await errorBanner.first().innerText()).trim();
        let backendLog = "(unavailable)";
        const candidates = [
          join(userDataDir, "Logs", "backend.log"),
          join(userDataDir, "logs", "backend.log"),
        ];
        for (const p of candidates) {
          try {
            backendLog = readFileSync(p, "utf8")
              .split("\n")
              .slice(-40)
              .join("\n");
            break;
          } catch {
            // try next
          }
        }
        throw new Error(
          `Session start hit an error banner under stripped env:\n${text}\n\n--- backend.log (tail) ---\n${backendLog}`,
        );
      }
    } finally {
      try {
        await app.close();
      } catch {
        // already closed
      }
    }
  } finally {
    for (const dir of [userDataDir, backendDataDir, tempProjectPath]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
});
