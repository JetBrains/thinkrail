/**
 * Shared Playwright `test` fixture for e2e specs.
 *
 * Currently only the `tempProject` fixture (a fresh `os.tmpdir()` project
 * directory) is bundled here. ThinkRail is single-user / localhost-only —
 * there is no auth fixture, no admin user, no token.
 */

export { test } from "./project";
export { expect } from "@playwright/test";
