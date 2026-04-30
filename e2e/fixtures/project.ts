import { test as base } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TempProject = { path: string };

export const test = base.extend<{ tempProject: TempProject }>({
  tempProject: async ({}, use) => {
    const path = mkdtempSync(join(tmpdir(), "bonsai-e2e-"));
    try {
      await use({ path });
    } finally {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // ignore — tests must not fail because of cleanup races
      }
    }
  },
});

export { expect } from "@playwright/test";
