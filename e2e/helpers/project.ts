import { expect, type Page } from "@playwright/test";
import { basename } from "node:path";
import { header, projectPicker } from "./selectors";

const BACKEND_URL = process.env.THINKRAIL_BACKEND_URL ?? "http://localhost:8000";

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
  // Opens the project from the picker and waits until we've left the picker
  // (workspace chrome up). This does NOT guarantee the full workspace layout:
  // the backend only opens straight into the sessions workspace (left-panel
  // Sessions/Specs/Files tabs, restored session) for an *initialized* project —
  // one holding a board ticket or a spec deliverable (`.tr/DESIGN_DOC.md`). A
  // project with only sessions/drafts on disk is "new"/"existing" and lands on
  // the onboarding wizard, which has no left panel. Callers that need the left
  // panel must seed an initialized marker first: `seedTicket(...)` or
  // `seedDeliverable(...)` (helpers/board.ts).
  await registerKnownProject(path);

  if (page.url() === "about:blank") {
    await page.goto("/");
  }

  // Match by absolute path so two recents with the same basename (e.g. parallel
  // worktrees) don't collide.
  const recent = page.locator(projectPicker.recentItem, { hasText: path });
  await expect(recent).toBeVisible({ timeout: 15_000 });
  await recent.first().click();

  // The header settings gear renders only inside the workspace (never on the
  // picker), so its appearance confirms we've left the picker and the
  // workspace chrome is up.
  await expect(page.locator(header.settingsButton)).toBeVisible({ timeout: 30_000 });
}
