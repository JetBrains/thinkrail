/**
 * Combined Playwright `test` fixture: admin user + temporary project directory.
 *
 * Spec files should import from this module instead of pulling individual fixtures
 * so each spec gets the same defaults.
 */

import { mergeTests } from "@playwright/test";
import { test as adminTest } from "./admin";
import { test as projectTest } from "./project";

export const test = mergeTests(adminTest, projectTest);
export { expect } from "@playwright/test";
