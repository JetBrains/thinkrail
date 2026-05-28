import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import {
  appShell,
  header,
  leftPanel,
  newSession,
  sessionManager,
  statusBar,
  ticketDetail,
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

type SeedStatus =
  | "draft"
  | "initializing"
  | "idle"
  | "running"
  | "waiting"
  | "done"
  | "error"
  | "interrupted";

interface SeedOptions {
  status?: SeedStatus;
  metaTicketId?: string | null;
  updatedAt?: string;
}

// Mirrors backend/app/board/storage.py:write_ticket.
function seedTicket(
  projectPath: string,
  id: string,
  title: string,
  sessionIds: string[] = [],
): void {
  const dir = join(projectPath, ".bonsai", "meta-tickets");
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const ticket = {
    id,
    title,
    body: "",
    status: "idea",
    type: "feature",
    sessionIds,
    linkedSpecIds: [],
    specPatches: [],
    order: 0,
    created: now,
    updated: now,
  };
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify(ticket, null, 2),
    "utf8",
  );
}

// Mirrors backend/app/agent/persistence.py:save_session.
function seedSession(
  projectPath: string,
  bonsaiSid: string,
  name: string,
  opts: SeedOptions | SeedStatus = {},
): void {
  const normalized: SeedOptions =
    typeof opts === "string" ? { status: opts } : opts;
  const status = normalized.status ?? "done";
  const now = new Date().toISOString();
  const dir = join(projectPath, ".bonsai", "sessions");
  mkdirSync(dir, { recursive: true });
  const meta = {
    bonsaiSid,
    name,
    skillId: null,
    specIds: [],
    status,
    config: { model: "claude-haiku-4-5-20251001", permissionMode: "default" },
    metaTicketId: normalized.metaTicketId ?? null,
    createdAt: normalized.updatedAt ?? now,
    updatedAt: normalized.updatedAt ?? now,
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

  test("clicking a done card from Board view switches center view to Sessions", async ({
    page,
  }) => {
    await page.getByRole(header.boardTab.role, { name: header.boardTab.name }).click();
    await expect(
      page.getByRole(header.boardTab.role, { name: header.boardTab.name }),
    ).toHaveAttribute("aria-selected", "true");

    await page.locator(leftPanel.sessionsTab).click();
    const card = page.locator(sessionManager.card, { hasText: "Sidebar Session A" });
    await expect(card).toBeVisible();
    await card.click();

    // The whole card is the open/switch/restore affordance.
    await expect(
      page.getByRole(header.sessionsTab.role, { name: header.sessionsTab.name }),
    ).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Sidebar Sessions — IDE-tab card layout", () => {
  test("renders status dot + flat list; the only explicit button is Delete (hover-revealed)", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_draft1", "Draft One", "draft");
    seedSession(tempProject.path, "bs_e2e_done1", "Done One", "done");
    seedSession(tempProject.path, "bs_e2e_err1", "Err One", "error");
    seedSession(tempProject.path, "bs_e2e_intr1", "Interrupted One", "idle");
    await openProject(page, tempProject.path);

    await page.locator(leftPanel.sessionsTab).click();
    await expect(page.locator(sessionManager.panel)).toBeVisible();
    await expect(page.locator(sessionManager.card)).toHaveCount(4);

    // No status group headings — flat layout.
    await expect(page.locator(".sm-group-label")).toHaveCount(0);

    // Every card has exactly one button (the hover-revealed trash icon).
    // No Open / Switch-to / Continue / Stop buttons anywhere.
    await expect(page.locator(sessionManager.card).getByRole("button")).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: /^(Open|Continue|Switch to|Stop)$/ }),
    ).toHaveCount(0);

    // Each card has a status dot matching its (potentially coerced) status.
    const cardFor = (name: string) =>
      page.locator(sessionManager.card, { hasText: name });
    await expect(cardFor("Draft One").locator(".sm-dot--draft")).toBeVisible();
    await expect(cardFor("Done One").locator(".sm-dot--done")).toBeVisible();
    await expect(cardFor("Err One").locator(".sm-dot--error")).toBeVisible();
    // idle-on-disk got coerced to interrupted by the backend (no live runner).
    await expect(cardFor("Interrupted One").locator(".sm-dot--interrupted")).toBeVisible();
  });

  test("sorts the panel by updatedAt descending (newest first)", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_old", "Older Session", {
      status: "done",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    seedSession(tempProject.path, "bs_e2e_mid", "Middle Session", {
      status: "done",
      updatedAt: "2026-02-01T00:00:00Z",
    });
    seedSession(tempProject.path, "bs_e2e_new", "Newer Session", {
      status: "done",
      updatedAt: "2026-03-01T00:00:00Z",
    });
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    await expect(page.locator(sessionManager.card)).toHaveCount(3);

    const names = await page.locator(`${sessionManager.card} .sm-name`).allTextContents();
    expect(names).toEqual(["Newer Session", "Middle Session", "Older Session"]);
  });

  test("ticket-attached cards render the ticket chip with stripe + title + short id", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_unt", "Unattached Card", { status: "done" });
    seedSession(tempProject.path, "bs_e2e_att", "Ticket-Linked Card", {
      status: "done",
      metaTicketId: "ticket-stub-12345",
    });
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    await expect(page.locator(sessionManager.card)).toHaveCount(2);

    const attached = page.locator(sessionManager.card, { hasText: "Ticket-Linked Card" });
    const unattached = page.locator(sessionManager.card, { hasText: "Unattached Card" });

    // The chip renders for any ticket-attached session — even when the
    // board store hasn't loaded the underlying ticket yet, it shows the
    // stripe + short-id derived from metaTicketId. Unattached cards have
    // no chip at all (the row collapses).
    await expect(unattached.locator(sessionManager.ticketChip)).toHaveCount(0);
    await expect(attached.locator(sessionManager.ticketChip)).toBeVisible();
    await expect(attached.locator(sessionManager.ticketStripe)).toBeVisible();
    // Short id falls out of the last 4 chars of the metaTicketId fallback.
    await expect(attached.locator(sessionManager.ticketId)).toHaveText("#2345");
  });
});

test.describe("Sidebar Sessions — event-driven refresh", () => {
  test("creating a draft via + New makes it appear in the panel without manual refresh", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_seed1", "Seed Session", "done");
    await openProject(page, tempProject.path);

    await page.locator(leftPanel.sessionsTab).click();
    const seedCard = page.locator(sessionManager.card, {
      hasText: "Seed Session",
    });
    await expect(seedCard).toBeVisible();
    // Only the seeded done card is in the panel at this point.
    await expect(page.locator(sessionManager.card)).toHaveCount(1);

    // Trigger a remote `session/didCreate` by creating a draft via the
    // session tab bar. SessionManager should refetch without the user
    // hitting ↻.
    await page.locator(newSession.newButton).click();

    // The new draft card joins the flat panel — a card carrying the
    // draft-status dot. No "Open" button: the whole card is the open
    // affordance now.
    await expect(page.locator(sessionManager.card)).toHaveCount(2);
    const newDraft = page
      .locator(sessionManager.card, { has: page.locator(".sm-dot--draft") });
    await expect(newDraft).toBeVisible();
  });
});

test.describe("Sidebar Sessions — right-click context menu", () => {
  test("right-click on a ticket-attached card shows Open ticket + the session id", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_ctx1", "Card With Ticket", {
      status: "done",
      metaTicketId: "ticket-stub-12345",
    });
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    const card = page.locator(sessionManager.card, { hasText: "Card With Ticket" });
    await expect(card).toBeVisible();

    await card.click({ button: "right" });
    await expect(page.locator(sessionManager.ctxMenu)).toBeVisible();

    const items = page.locator(sessionManager.ctxMenuItem);
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText("Open ticket");
    // The second item IS the bonsaiSid — click it to copy.
    await expect(items.nth(1)).toContainText("bs_e2e_ctx1");
    await expect(items.nth(1)).toHaveAttribute("title", /^Click to copy: bs_e2e_ctx1$/);
  });

  test("right-click on an unattached card hides 'Open ticket' but keeps the session-id item", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_ctx2", "Untethered Card", "done");
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    const card = page.locator(sessionManager.card, { hasText: "Untethered Card" });
    await expect(card).toBeVisible();

    await card.click({ button: "right" });
    await expect(page.locator(sessionManager.ctxMenu)).toBeVisible();

    const items = page.locator(sessionManager.ctxMenuItem);
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toContainText("bs_e2e_ctx2");
  });

  test("'Open ticket' focuses the chosen session — including when the ticket is already open", async ({
    page,
    tempProject,
  }) => {
    // Two sessions attached to the same ticket. The ticket detail
    // defaults to the *last* session; we want to verify both that
    // (a) the pending hint overrides that default on initial mount, and
    // (b) the hint also retargets the right-panel when the ticket
    //     detail is already mounted (the user-reported case).
    const ticketId = "tic-focus-9";
    const sidA = "bs_e2e_focusA";
    const sidB = "bs_e2e_focusB";
    seedTicket(tempProject.path, ticketId, "Focus Test Ticket", [sidA, sidB]);
    seedSession(tempProject.path, sidA, "Session A", {
      status: "done",
      metaTicketId: ticketId,
    });
    seedSession(tempProject.path, sidB, "Session B", {
      status: "done",
      metaTicketId: ticketId,
    });

    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();

    const cardA = page.locator(sessionManager.card, { hasText: "Session A" });
    const cardB = page.locator(sessionManager.card, { hasText: "Session B" });
    await expect(cardA).toBeVisible();
    await expect(cardB).toBeVisible();

    // First open via B's card — mounts the ticket detail with B focused.
    await cardB.click({ button: "right" });
    await page.locator(sessionManager.ctxMenuItem, { hasText: "Open ticket" }).click();
    await expect(page.locator(ticketDetail.root)).toBeVisible();
    await expect(
      page.locator(`${ticketDetail.linkedItem}.ticket-linked-item--active`, { hasText: "Session B" }),
    ).toBeVisible();

    // Now go back to the sidebar and ask for Session A. The ticket
    // detail stays mounted (same ticket); only the focused session
    // should change.
    await page.locator(leftPanel.sessionsTab).click();
    await cardA.click({ button: "right" });
    await page.locator(sessionManager.ctxMenuItem, { hasText: "Open ticket" }).click();
    await expect(
      page.locator(`${ticketDetail.linkedItem}.ticket-linked-item--active`, { hasText: "Session A" }),
    ).toBeVisible();
    await expect(
      page.locator(`${ticketDetail.linkedItem}.ticket-linked-item--active`, { hasText: "Session B" }),
    ).toHaveCount(0);
  });

  test("Escape closes the context menu", async ({ page, tempProject }) => {
    seedSession(tempProject.path, "bs_e2e_ctx3", "Escapable Card", "done");
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    const card = page.locator(sessionManager.card, { hasText: "Escapable Card" });
    await card.click({ button: "right" });
    await expect(page.locator(sessionManager.ctxMenu)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(sessionManager.ctxMenu)).toHaveCount(0);
  });
});

test.describe("Sidebar Sessions — card affordances", () => {
  test("each card shows a lowercase status word next to the (hover-revealed) delete icon", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_aff_draft", "Aff Draft", "draft");
    seedSession(tempProject.path, "bs_e2e_aff_done", "Aff Done", "done");
    seedSession(tempProject.path, "bs_e2e_aff_err", "Aff Err", "error");
    seedSession(tempProject.path, "bs_e2e_aff_int", "Aff Interrupted", "idle");
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    await expect(page.locator(sessionManager.card)).toHaveCount(4);

    const labelFor = (name: string) =>
      page
        .locator(sessionManager.card, { hasText: name })
        .locator(".sm-status-label");
    await expect(labelFor("Aff Draft")).toHaveText("draft");
    await expect(labelFor("Aff Done")).toHaveText("done");
    await expect(labelFor("Aff Err")).toHaveText("error");
    await expect(labelFor("Aff Interrupted")).toHaveText("interrupted");
  });

  test("draft cards show a time stamp (not the literal word 'draft') in the time slot", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_dr_time", "Draft Time", {
      status: "draft",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();

    const card = page.locator(sessionManager.card, { hasText: "Draft Time" });
    await expect(card).toBeVisible();
    const timeText = await card.locator(".sm-time").innerText();
    // Status badge says "draft" elsewhere; the time slot must be a real
    // relative-time string ("X ago" / "now") not the word "draft".
    expect(timeText.trim().toLowerCase()).not.toBe("draft");
    expect(timeText).toMatch(/ago|now|just/i);
  });

  test("Delete icon removes the card", async ({ page, tempProject }) => {
    seedSession(tempProject.path, "bs_e2e_del", "Card To Delete", "done");
    seedSession(tempProject.path, "bs_e2e_keep", "Card To Keep", "done");
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    await expect(page.locator(sessionManager.card)).toHaveCount(2);

    const target = page.locator(sessionManager.card, { hasText: "Card To Delete" });
    await target.hover();
    await target.locator(sessionManager.deleteBtn).click();

    await expect(target).toHaveCount(0);
    await expect(
      page.locator(sessionManager.card, { hasText: "Card To Keep" }),
    ).toBeVisible();
  });
});

test.describe("Sidebar Sessions — context menu dismissal & copy toast", () => {
  test("clicking outside the context menu closes it", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_outside", "Outside Card", "done");
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    const card = page.locator(sessionManager.card, { hasText: "Outside Card" });
    await card.click({ button: "right" });
    await expect(page.locator(sessionManager.ctxMenu)).toBeVisible();

    // Click somewhere clearly outside the menu — the AppShell header is a
    // safe target that exists on every page.
    await page.locator(".app-shell, body").first().click({ position: { x: 500, y: 5 } });
    await expect(page.locator(sessionManager.ctxMenu)).toHaveCount(0);
  });

  test("clicking the session-id row emits a 'Copied session ID' toast", async ({
    page,
    context,
    tempProject,
  }) => {
    // Chromium needs an explicit grant to let navigator.clipboard.writeText
    // resolve in a non-secure local context.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    seedSession(tempProject.path, "bs_e2e_toast", "Toast Card", "done");
    await openProject(page, tempProject.path);
    await page.locator(leftPanel.sessionsTab).click();
    const card = page.locator(sessionManager.card, { hasText: "Toast Card" });
    await card.click({ button: "right" });
    await expect(page.locator(sessionManager.ctxMenu)).toBeVisible();

    await page.locator(".sm-ctx-menu-item--id").click();
    await expect(
      page.locator(".toast-message", { hasText: /Copied session ID/ }),
    ).toBeVisible();
  });
});

test.describe("Sidebar Sessions — footer count reconciliation", () => {
  test("footer 'N sessions' pill matches the count of cards in the panel", async ({
    page,
    tempProject,
  }) => {
    seedSession(tempProject.path, "bs_e2e_fc_done", "FC Done", "done");
    seedSession(tempProject.path, "bs_e2e_fc_err", "FC Err", "error");
    seedSession(tempProject.path, "bs_e2e_fc_draft", "FC Draft", "draft");
    await openProject(page, tempProject.path);

    // Panel renders three cards.
    await page.locator(leftPanel.sessionsTab).click();
    await expect(page.locator(sessionManager.card)).toHaveCount(3);

    // Footer pill is sourced from the same session/list response.
    const pill = page.locator(statusBar.sessionsButton);
    await expect(pill).toHaveText(/^3 sessions$/);
  });
});
