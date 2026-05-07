import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/openProject";
import { startSessionConnectivityCheck } from "../../helpers/session";
import { chatStream } from "../../helpers/selectors";

/**
 * Regression: starting a session from inside the Electron app surfaced
 * `turn_error` "Not logged in · Please run /login" while the same session
 * model worked fine in the dev browser flow.
 *
 * The spec reaches the same end-state the user hit: open project → New →
 * pick the smallest available Haiku model → ▶ Start Session → wait for
 * either an `agent/error` banner or normal session activity. Failure here
 * means the spawned PyInstaller backend can't talk to Anthropic from
 * inside Electron.
 *
 * On failure we surface the backend log from the per-test userData dir to
 * make diagnosis possible without manual rerunning.
 */
test("starts a session inside Electron without auth error", async ({
  electronApp,
  tempProject,
}) => {
  const { window, userDataDir } = electronApp;

  await openProject(window, tempProject.path);

  await startSessionConnectivityCheck(window, { label: "Haiku 4.5" });

  const errorBanner = window.locator(chatStream.errorBanner);
  const sessionActivity = window.locator(chatStream.activitySelectors);

  await expect
    .poll(
      async () =>
        (await errorBanner.count()) > 0 || (await sessionActivity.count()) > 0,
      {
        timeout: 90_000,
        message: "no error banner and no session activity within timeout",
      },
    )
    .toBe(true);

  if ((await errorBanner.count()) > 0) {
    const text = (await errorBanner.first().innerText()).trim();
    let backendLog = "(unavailable)";
    // app.getPath('logs') resolves under userData on macOS once
    // --user-data-dir overrides the default location.
    const candidatePaths = [
      join(userDataDir, "Logs", "backend.log"),
      join(userDataDir, "logs", "backend.log"),
      join(process.env.HOME ?? "", "Library/Logs/Bonsai/backend.log"),
    ];
    for (const p of candidatePaths) {
      try {
        backendLog = readFileSync(p, "utf8").split("\n").slice(-40).join("\n");
        break;
      } catch {
        // try next candidate
      }
    }
    throw new Error(
      `Session start hit an error banner:\n${text}\n\n--- backend.log (tail) ---\n${backendLog}`,
    );
  }
});
