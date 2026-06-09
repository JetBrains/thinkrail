import { expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { appShell, projectPicker } from "./selectors";

const BACKEND_URL = process.env.BONSAI_BACKEND_URL ?? "http://localhost:8000";

// The picker's two top CTAs trigger a native osascript folder dialog Playwright
// cannot drive — the recents list is the only DOM-driveable path.
async function registerKnownProject(path: string): Promise<void> {
  const url = `${BACKEND_URL.replace(/\/$/, "")}/api/projects/known`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name: basename(path) }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to register known project ${path}: ${res.status} ${await res.text()}`,
    );
  }
}

export async function openProject(page: Page, path: string): Promise<void> {
  // The backend opens straight to the sessions workspace (the status bar these
  // specs drive) only for an "initialized" project — one holding a spec
  // deliverable, board ticket, or plan. An empty dir is "new" (welcome) and a
  // dir with files but no spec is "existing" (investigation wizard); both lack
  // the status bar. A non-empty `.bonsai/plans/` flips the state to
  // "initialized" without surfacing anything in the UI: plans are loaded per
  // meta-ticket, so an unreferenced marker file appears in no panel.
  const planMarker = join(path, ".bonsai", "plans", ".gitkeep");
  if (!existsSync(planMarker)) {
    mkdirSync(dirname(planMarker), { recursive: true });
    writeFileSync(planMarker, "", "utf8");
  }

  await registerKnownProject(path);

  if (page.url() === "about:blank") {
    await page.goto("/");
  }

  // Match by absolute path so two recents with the same basename (e.g. parallel
  // worktrees) don't collide.
  const recent = page.locator(projectPicker.recentItem, { hasText: path });
  await expect(recent).toBeVisible({ timeout: 15_000 });
  await recent.first().click();

  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible({ timeout: 30_000 });
}
