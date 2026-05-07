/**
 * Shared Playwright `test` fixture for electron e2e specs.
 *
 *   - electronApp: per-test ElectronApplication + first window, with isolated
 *     userData dir.
 *   - tempProject: fresh `os.tmpdir()` directory, cleaned up on teardown.
 *
 * Bonsai is single-user / localhost-only — no auth, no token, no login screen.
 * Every spec opens a fresh tempProject straight from the ProjectPicker.
 */

export { test, expect } from "./electronApp";
export type { ElectronContext, TempProject } from "./electronApp";
