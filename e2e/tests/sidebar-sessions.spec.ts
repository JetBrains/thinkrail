import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import {
  appShell,
  header,
  leftPanel,
  sessionManager,
} from "../helpers/selectors";

/**
 * Sidebar Sessions tab — coverage for the Progress → Sessions refactor:
 *  - The left panel renders Specs / Files / Sessions (no Progress tab).
 *  - The footer "n sessions" button focuses the Sessions tab and uncollapses
 *    the panel when it was hidden.
 *  - Switching the center view to Sessions via the header tab auto-focuses
 *    the sidebar Sessions tab — uiStore.focusSessions().
 *  - Clicking a session card in the sidebar switches the center view to
 *    Sessions and opens that session's tab — even from Board view.
 *
 * Sessions are seeded directly to `.bonsai/sessions/` so the spec doesn't
 * need an LLM round-trip.
 */

// Mirrors backend/app/agent/persistence.py:save_session.
function seedSession(
  projectPath: string,
  bonsaiSid: string,
  name: string,
  status: "done" | "idle" | "running" | "error" = "done",
): void {
  const dir = join(projectPath, ".bonsai", "sessions");
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = {
    bonsaiSid,
    name,
    skillId: null,
    specIds: [],
    status,
    config: { model: "claude-haiku-4-5-20251001", maxTurns: 100, permissionMode: "default" },
    createdAt: now,
    updatedAt: now,
    metrics: {},
  };
  writeFileSync(
    join(dir, `${bonsaiSid}.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  writeFileSync(join(dir, `${bonsaiSid}.events.jsonl`), "", "utf8");
}

test.describe("Sidebar Sessions tab", () => {
  test.beforeEach(async ({ page, tempProject }) => {
    seedSession(tempProject.path, "bs_e2e_sidebar1", "Sidebar Session A");
    await openProject(page, tempProject.path);
  });

  test("renders three tabs (no Progress) and lists seeded sessions", async ({
    page,
  }) => {
    const tabs = page.locator(leftPanel.panelTab);
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText(/Specs/i);
    await expect(tabs.nth(1)).toHaveText(/Files/i);
    await expect(tabs.nth(2)).toHaveText(/Sessions/i);
    // Progress tab must be gone.
    await expect(
      page.locator("button.panel-tab", { hasText: /Progress/i }),
    ).toHaveCount(0);

    await page.locator(leftPanel.sessionsTab).click();
    await expect(page.locator(sessionManager.panel)).toBeVisible();
    await expect(
      page.locator(sessionManager.card, { hasText: "Sidebar Session A" }),
    ).toBeVisible();
  });

  test("footer 'n sessions' button focuses the Sessions tab and uncollapses the panel", async ({
    page,
  }) => {
    // Start on Specs so we can observe the tab switch.
    await page.locator(leftPanel.specsTab).click();
    await expect(page.locator(leftPanel.specsTab)).toHaveClass(/panel-tab-active/);

    // Collapse the left panel via the in-panel "Hide panel" button so we can
    // verify the footer click also uncollapses it. Avoids the platform-
    // conditional Mod key (Ctrl on macOS, Alt elsewhere).
    await page
      .locator(".left-panel")
      .getByRole("button", { name: "Hide panel" })
      .click();
    await expect(page.locator(leftPanel.panelTab)).toHaveCount(0);

    await page.getByText(appShell.statusSessionsLabel).click();
    // Uncollapsed.
    await expect(page.locator(leftPanel.sessionsTab)).toBeVisible();
    // And focused.
    await expect(page.locator(leftPanel.sessionsTab)).toHaveClass(
      /panel-tab-active/,
    );
    await expect(page.locator(sessionManager.panel)).toBeVisible();
  });

  test("switching center view to Sessions auto-focuses the left Sessions tab", async ({
    page,
  }) => {
    // Force the left panel onto Specs first.
    await page.locator(leftPanel.specsTab).click();
    await expect(page.locator(leftPanel.specsTab)).toHaveClass(/panel-tab-active/);

    // Header tab → Board (left should stay on Specs — only sessions couples).
    await page.getByRole(header.boardTab.role, { name: header.boardTab.name }).click();
    await expect(page.locator(leftPanel.specsTab)).toHaveClass(/panel-tab-active/);

    // Header tab → Sessions. Coupling kicks in: left Sessions becomes active.
    await page
      .getByRole(header.sessionsTab.role, { name: header.sessionsTab.name })
      .click();
    await expect(page.locator(leftPanel.sessionsTab)).toHaveClass(
      /panel-tab-active/,
    );
  });

  test("clicking a session card from Board view switches center view to Sessions", async ({
    page,
  }) => {
    // Land on Board.
    await page.getByRole(header.boardTab.role, { name: header.boardTab.name }).click();
    await expect(
      page.getByRole(header.boardTab.role, { name: header.boardTab.name }),
    ).toHaveAttribute("aria-selected", "true");

    // Open the Sessions tab in the sidebar (footer button is the canonical
    // route, but here we go via the tab to keep the assertion focused).
    await page.locator(leftPanel.sessionsTab).click();
    const card = page.locator(sessionManager.card, {
      hasText: "Sidebar Session A",
    });
    await expect(card).toBeVisible();

    await card.click();

    // Center view flipped to Sessions.
    await expect(
      page.getByRole(header.sessionsTab.role, { name: header.sessionsTab.name }),
    ).toHaveAttribute("aria-selected", "true");
    // And the session's tab is in the SessionPanel.
    await expect(
      page.locator(".session-tab", { hasText: "Sidebar Session A" }),
    ).toBeVisible();
  });

  // Note: the Active-group / "Switch to" branch of handleOpen is not covered
  // here because `backend/app/agent/persistence.py:list_sessions` coerces
  // any disk-only session with a non-terminal status to "interrupted" (no
  // live agent attached). That means disk-seeded `status: "idle"` sessions
  // never appear in the SessionManager's `active` filter — testing that
  // branch needs a live agent (LLM spec) or an in-memory store injection.

  test("clicking Continue on a done card from Board view switches center view", async ({
    page,
  }) => {
    await page.getByRole(header.boardTab.role, { name: header.boardTab.name }).click();
    await expect(
      page.getByRole(header.boardTab.role, { name: header.boardTab.name }),
    ).toHaveAttribute("aria-selected", "true");

    await page.locator(leftPanel.sessionsTab).click();
    const continueBtn = page
      .locator(sessionManager.card, { hasText: "Sidebar Session A" })
      .locator(sessionManager.continueBtn);
    await expect(continueBtn).toBeVisible();
    await continueBtn.click();

    // focusSessions() runs synchronously before continueSession's async work,
    // so the center view flip should be observable even if the resume itself
    // fails (e.g. no live agent in this test environment).
    await expect(
      page.getByRole(header.sessionsTab.role, { name: header.sessionsTab.name }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
