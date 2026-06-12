import { test as base } from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TempProject = { path: string };

const BACKEND_URL = process.env.THINKRAIL_BACKEND_URL ?? "http://localhost:8000";

/**
 * Best-effort: remove the project from the backend's known-projects registry.
 *
 * ThinkRail is single-user — there's no per-user view that scopes recent projects.
 * Without this teardown, every test leaks a recent into the AppStore, and after
 * ~20 tests the picker layout pushes the "Open Project" button outside the
 * viewport, breaking subsequent specs.
 *
 * The AppStore stores the resolved form (Path.resolve), so we delete both the
 * raw and the realpath variants — on macOS `/var/folders/...` resolves to
 * `/private/var/folders/...`, and either form may have been registered
 * depending on how the test opened the project.
 */
async function unregisterKnownProject(path: string): Promise<void> {
  const candidates = new Set<string>([path]);
  try {
    candidates.add(realpathSync(path));
  } catch {
    // path may already be deleted by rmSync — ignore
  }
  for (const p of candidates) {
    const url = `${BACKEND_URL.replace(/\/$/, "")}/api/projects/known?path=${encodeURIComponent(p)}`;
    try {
      await fetch(url, { method: "DELETE" });
    } catch {
      // Best-effort — never fail teardown over a recents-cleanup miss.
    }
  }
}

export const test = base.extend<{ tempProject: TempProject }>({
  tempProject: async ({}, use) => {
    const path = mkdtempSync(join(tmpdir(), "thinkrail-e2e-"));
    try {
      await use({ path });
    } finally {
      await unregisterKnownProject(path);
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // ignore — tests must not fail because of cleanup races
      }
    }
  },
});

export { expect } from "@playwright/test";
