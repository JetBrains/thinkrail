import { _electron as electron, expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startSessionConnectivityCheck } from "../../helpers/session";
import { appShell, chatStream, projectPicker } from "../../helpers/selectors";

/**
 * Regression spec for the shell-env import path (`electron/src/shellEnv.ts`).
 *
 * When Bonsai.app is launched from Finder/dock, launchd starts it with a
 * stripped env. shellEnv.ts compensates by spawning the user's interactive
 * login shell ($SHELL -ilc 'env') and merging its output into process.env.
 *
 * To stay hermetic this spec swaps $SHELL for a tiny script that prints
 * `ANTHROPIC_API_KEY=...` — exactly what a real user's `.zshrc` would
 * cause via `export ANTHROPIC_API_KEY=...`. A green test means
 * shellEnv.ts spawned the fake shell, parsed its output, and the key
 * reached the backend.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ELECTRON_DIR = resolve(REPO_ROOT, "electron");
const BACKEND_DIR = resolve(REPO_ROOT, "packaging", "dist", "bonsai-dir");
const ELECTRON_BINARY = createRequire(`${ELECTRON_DIR}/package.json`)(
  "electron",
) as string;

test("imports ANTHROPIC_API_KEY from the user's login shell on Finder-style launch", async () => {
  const realKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  test.skip(
    realKey === "",
    "ANTHROPIC_API_KEY must be set in the test runner env to seed the fake shell output",
  );

  const userDataDir = mkdtempSync(join(tmpdir(), "bonsai-e2e-shellenv-ud-"));
  const backendDataDir = mkdtempSync(join(tmpdir(), "bonsai-e2e-shellenv-data-"));
  const tempProjectPath = mkdtempSync(join(tmpdir(), "bonsai-e2e-shellenv-proj-"));
  const fakeShellDir = mkdtempSync(join(tmpdir(), "bonsai-e2e-shellenv-shell-"));
  const fakeShell = join(fakeShellDir, "fake-shell");

  // Mimic a real login shell: shellEnv.ts invokes `$SHELL -ilc <cmd>`, where
  // <cmd> is `echo MARKER; env; echo MARKER`. A real shell would source the
  // user's rc files (which export ANTHROPIC_API_KEY) and then run <cmd>. We
  // skip the rc-sourcing step and just export the key directly, then dispatch
  // <cmd> to /bin/sh -c so the marker/env protocol still works regardless of
  // what shellEnv.ts changes the inner command to.
  writeFileSync(
    fakeShell,
    `#!/bin/sh\n# args: $1=-ilc  $2=<cmd from shellEnv.ts>\nexport ANTHROPIC_API_KEY='${realKey}'\nexec /bin/sh -c "$2"\n`,
    { mode: 0o755 },
  );
  chmodSync(fakeShell, 0o755);

  try {
    // Mimic launchd / Finder launch: minimal env, but with $SHELL pointing
    // at our fake shell so shellEnv.ts has something to import from.
    // Crucially we DO NOT pass ANTHROPIC_API_KEY in the launched env — if
    // shellEnv.ts didn't run, the backend would have no key.
    // No TERM_PROGRAM so the skip-on-terminal check passes. We DO set `_`
    // (launchd sets it on Finder launches): if a future change re-adds the
    // `_` heuristic, the import would be skipped and this test would fail —
    // exactly the regression we want to catch.
    const minimalEnv: Record<string, string> = {
      HOME: process.env.HOME!,
      USER: process.env.USER!,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      SHELL: fakeShell,
      _: fakeShell,
      BONSAI_BACKEND_DIR: BACKEND_DIR,
      BONSAI_DATA_DIR: backendDataDir,
    };

    const app = await electron.launch({
      executablePath: ELECTRON_BINARY,
      args: [ELECTRON_DIR, `--user-data-dir=${userDataDir}`],
      env: minimalEnv,
      timeout: 60_000,
    });
    const window = await app.firstWindow();

    try {
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
          `Session start hit an error banner under stripped env (shell-env import path):\n${text}\n\n--- backend.log (tail) ---\n${backendLog}`,
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
    for (const dir of [userDataDir, backendDataDir, tempProjectPath, fakeShellDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
});
