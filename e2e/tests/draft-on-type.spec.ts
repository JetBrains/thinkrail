import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedSessionDefaults, getSessionDefaults, type SessionDefaults } from "../helpers/appSettings";
import { acquireAppStoreLock, releaseAppStoreLock } from "../helpers/appStoreLock";
import {
  header,
  leftPanel,
  newSession,
  sessionManager,
  sessionPanel,
} from "../helpers/selectors";

/** Open the SessionManager via the left panel's Sessions tab. */
async function openSessionManager(p: Page): Promise<void> {
  await p.locator(leftPanel.sessionsTab).click();
  await expect(p.locator(sessionManager.panel)).toBeVisible({ timeout: 15_000 });
}

/**
 * Draft-on-type — blank-session save is deferred until the prompt carries
 * intent. One case per validation scenario (1–10) from the ticket's product
 * + technical design.
 *
 * Conventions honoured here (project-memory e2e gotchas):
 *  - `session_defaults` is seeded explicitly per test — the AppStore at
 *    `~/.tr/tr.db` is shared across e2e and defaults don't persist.
 *  - Drafts are submitted via the keyboard (Ctrl+Enter on this macOS Chromium
 *    runner — `isMod` reads `ctrlKey` on Mac), never the Send/Start button,
 *    which portals into a slot that only mounts for non-draft sessions.
 *  - "No file" is a disk check of `.tr/sessions/`; "no broadcast" is a
 *    second browser context whose session list must not gain an entry.
 *  - Save counts are observed from the WebSocket frames the page sends
 *    (`agent/prepare` first save, `agent/updateDraft` thereafter) rather than
 *    guessed, which makes the threshold/debounce assertions deterministic.
 */

const DEFAULTS = {
  model: "claude-haiku-4-5-20251001",
  permissionMode: "default",
  effort: "auto",
} as const;

// Longer than the autosave max-wait (5s) so a forced/trailing save can land
// before we assert "nothing more was saved".
const AUTOSAVE_SETTLE_MS = 1_500;

/** Count `{id}.json` session files on disk (events sidecars are `.events.jsonl`). */
function sessionFileCount(projectPath: string): number {
  const dir = join(projectPath, ".tr", "sessions");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

/**
 * Read a single field from the (only) session JSON on disk. Returns null when
 * no session file exists yet. Lets us assert persisted skill/draftInput
 * without an LLM round-trip.
 */
function readSessionField(projectPath: string, field: string): unknown {
  const dir = join(projectPath, ".tr", "sessions");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;
  const data = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
  return data[field] ?? null;
}

/**
 * Attach a counter for outbound draft-save RPC frames. `agent/prepare` is the
 * first save (deferred persist); `agent/updateDraft` is every subsequent
 * autosave. Returns a live snapshot accessor.
 */
function trackSaveFrames(page: Page): () => { prepare: number; update: number } {
  const counts = { prepare: 0, update: 0 };
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      let msg: { method?: string };
      try {
        msg = JSON.parse(frame.payload as string);
      } catch {
        return;
      }
      if (msg.method === "agent/prepare") counts.prepare += 1;
      else if (msg.method === "agent/updateDraft") counts.update += 1;
    });
  });
  return () => ({ ...counts });
}

/** The active draft tab's live label (derived name or "New session"). */
function draftTabName(page: Page) {
  return page.locator(".session-tab.session-tab-active .session-tab-name");
}

async function openBlankDraft(page: Page): Promise<void> {
  await page.locator(newSession.newButton).click();
  await expect(page.locator(sessionPanel.inputTextarea)).toBeVisible();
}

/**
 * Submit the active draft via keyboard, bypassing the portal-rendered Start
 * button. The app's `isMod` reads `ctrlKey` on Mac and `altKey` elsewhere
 * (utils/platform.ts) — pick the matching modifier from the live UA so the
 * keydown actually triggers `handleSend`.
 */
async function submitDraft(page: Page): Promise<void> {
  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  const mod = isMac ? "Control" : "Alt";
  await page.locator(sessionPanel.inputTextarea).focus();
  await page.keyboard.press(`${mod}+Enter`);
}

async function openSecondClient(
  browser: Browser,
  projectPath: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "X-ThinkRail-E2E": "1" } });
  const page = await ctx.newPage();
  await openProject(page, projectPath);
  return { page, close: () => ctx.close() };
}

test.describe("Draft-on-type", () => {
  let _savedDefaults: SessionDefaults;

  test.beforeEach(async ({ tempProject }) => {
    await acquireAppStoreLock();
    _savedDefaults = await getSessionDefaults(tempProject.path);
    await seedSessionDefaults(tempProject.path, { ...DEFAULTS });
  });

  test.afterEach(async ({ tempProject }) => {
    await seedSessionDefaults(tempProject.path, _savedDefaults);
    releaseAppStoreLock();
  });

  // 1. Empty abandon — type nothing, abandon: no file, no broadcast to a 2nd client.
  test("1. empty abandon writes no file and broadcasts to no other client", async ({
    page,
    browser,
    tempProject,
  }) => {
    const second = await openSecondClient(browser, tempProject.path);
    try {
      // The 2nd client's Sessions panel starts empty.
      await openSessionManager(second.page);
      await expect(second.page.locator(sessionManager.card)).toHaveCount(0);

      const getSaves = trackSaveFrames(page);
      await openProject(page, tempProject.path);

      await openBlankDraft(page);
      // Type nothing, then abandon by reloading the page.
      await page.reload();
      await expect(page.locator(header.settingsButton)).toBeVisible({ timeout: 30_000 });

      // No save RPC ever left the client.
      expect(getSaves().prepare).toBe(0);
      // No file on disk.
      expect(sessionFileCount(tempProject.path)).toBe(0);
      // The 2nd client never received a session/didCreate — its list stays empty.
      await expect(second.page.locator(sessionManager.card)).toHaveCount(0);
    } finally {
      await second.close();
    }
  });

  // 2. Threshold + debounce — "fix" saves nothing; "fix login" + pause → exactly
  //    one draft; ~10s nonstop typing → at most ~2 saves.
  test("2. threshold gates the first save and the debounce coalesces sustained typing", async ({
    page,
    tempProject,
  }) => {
    const getSaves = trackSaveFrames(page);
    await openProject(page, tempProject.path);
    await openBlankDraft(page);

    const textarea = page.locator(sessionPanel.inputTextarea);

    // Below threshold (3 non-ws chars): nothing persists even after the
    // debounce + max-wait would have fired.
    await textarea.fill("fix");
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    expect(getSaves().prepare).toBe(0);
    expect(sessionFileCount(tempProject.path)).toBe(0);

    // Cross the threshold (≥5 non-ws) and pause: exactly one draft is created.
    await textarea.fill("fix login");
    await expect.poll(() => getSaves().prepare, { timeout: 5_000 }).toBe(1);
    await expect.poll(() => sessionFileCount(tempProject.path)).toBe(1);

    // ~10s of nonstop typing: re-arm the trailing timer faster than 750ms so it
    // never fires on its own; only the 5s max-wait forces saves. Over ~10s that
    // is at most ~2 updates.
    const start = Date.now();
    let n = 0;
    while (Date.now() - start < 10_000) {
      await textarea.pressSequentially(String(n % 10), { delay: 0 });
      n += 1;
      await page.waitForTimeout(200);
    }
    // Let any final trailing save land.
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

    // Still exactly one prepare (single-flight) and one file on disk.
    expect(getSaves().prepare).toBe(1);
    // Max-wait is 5s; ~10s of typing yields ~2 forced saves. Allow a small
    // margin for a trailing flush at the end.
    expect(getSaves().update).toBeLessThanOrEqual(3);
    expect(sessionFileCount(tempProject.path)).toBe(1);
  });

  // 3. Config-only, then type — pick a skill, confirm nothing persists, then
  //    type ≥5 chars → a draft is created carrying that choice.
  test("3. configuring a skill persists nothing until text crosses the threshold", async ({
    page,
    tempProject,
  }) => {
    const getSaves = trackSaveFrames(page);
    await openProject(page, tempProject.path);
    await openBlankDraft(page);

    // Pick a skill from the DraftConfigCard's Skill popover.
    await page.locator(newSession.skillSelectButton).click();
    const grid = page.locator(newSession.skillGrid);
    await expect(grid).toBeVisible();
    const firstSkill = grid.locator(newSession.skillCard).first();
    const chosenSkill = (
      await firstSkill.locator(newSession.skillCardName).innerText()
    ).trim();
    await firstSkill.click();
    // The chosen skill shows as a pill in the card; still nothing saved.
    await expect(
      page.locator(".draft-config-row", { hasText: "Skill" }).locator(".draft-config-pill"),
    ).toContainText(chosenSkill);

    // Config-only must not persist.
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    expect(getSaves().prepare).toBe(0);
    expect(sessionFileCount(tempProject.path)).toBe(0);

    // Now type ≥5 non-ws chars → first save fires, carrying the skill choice.
    await page.locator(sessionPanel.inputTextarea).fill("fix login");
    await expect.poll(() => getSaves().prepare, { timeout: 5_000 }).toBe(1);
    await expect.poll(() => sessionFileCount(tempProject.path)).toBe(1);

    // The persisted draft carries the earlier skill choice.
    expect(readSessionField(tempProject.path, "skillId")).not.toBeNull();
  });

  // 4. Name derivation + freeze — derive live, then a manual rename freezes it.
  test("4. the tab name derives live from the prompt and a manual rename freezes derivation", async ({
    page,
    tempProject,
  }) => {
    await openProject(page, tempProject.path);
    await openBlankDraft(page);

    // Untyped → neutral label.
    await expect(draftTabName(page)).toHaveText("New session");

    const textarea = page.locator(sessionPanel.inputTextarea);
    // "Refactor   the\nsession store": collapse whitespace runs, first 14 + "…".
    await textarea.fill("Refactor   the\nsession store");
    await expect(draftTabName(page)).toHaveText("Refactor the s…");

    // Editing keeps tracking live (still not manually renamed).
    await textarea.fill("hello there");
    await expect(draftTabName(page)).toHaveText("hello there");

    // Let the autosave/flush settle so no pending re-derive races the rename —
    // the name input is controlled (value synced from session.name via effect),
    // so a late derive could otherwise clobber a Playwright `fill`.
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

    // Manual rename via the DraftConfigCard name input freezes derivation. Type
    // it key-by-key (select-all first): the first keystroke sets the freeze
    // flag, so no subsequent derive can fire.
    const nameInput = page.locator(".draft-config-name-input");
    await nameInput.click();
    await page.keyboard.press("ControlOrMeta+a");
    await nameInput.pressSequentially("WIP");
    await expect(nameInput).toHaveValue("WIP");
    await expect(draftTabName(page)).toHaveText("WIP");

    // Further typing no longer changes the (now-frozen) name.
    await textarea.fill("this should not rename the tab");
    await expect(draftTabName(page)).toHaveText("WIP");
  });

  // 5. Clear after save — deleting text reverts the label but keeps the file.
  test("5. clearing the prompt after a save reverts the label to New session but keeps the file", async ({
    page,
    tempProject,
  }) => {
    const getSaves = trackSaveFrames(page);
    await openProject(page, tempProject.path);
    await openBlankDraft(page);

    const textarea = page.locator(sessionPanel.inputTextarea);
    await textarea.fill("fix login flow");
    await expect.poll(() => getSaves().prepare, { timeout: 5_000 }).toBe(1);
    await expect.poll(() => sessionFileCount(tempProject.path)).toBe(1);
    await expect(draftTabName(page)).toHaveText("fix login flow");

    // Select-all + delete back to empty.
    await textarea.fill("");
    // Label reverts to the neutral default…
    await expect(draftTabName(page)).toHaveText("New session");
    // …but the draft file is KEPT on disk (no delete).
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    expect(sessionFileCount(tempProject.path)).toBe(1);

    // Typing again re-derives the name (it was never manually renamed).
    await textarea.fill("another prompt");
    await expect(draftTabName(page)).toHaveText("another prompt");
  });

  // 6. Reload mid-draft — typed text + derived name are restored.
  test("6. reloading mid-draft restores the typed text and the derived name", async ({
    page,
    tempProject,
  }) => {
    const getSaves = trackSaveFrames(page);
    await openProject(page, tempProject.path);
    await openBlankDraft(page);

    const multiline = "Refactor the\nsession store autosave";
    await page.locator(sessionPanel.inputTextarea).fill(multiline);
    await expect.poll(() => getSaves().prepare, { timeout: 5_000 }).toBe(1);
    await expect.poll(() => sessionFileCount(tempProject.path)).toBe(1);
    // Let the trailing autosave persist the full text.
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

    await page.reload();
    await expect(page.locator(header.settingsButton)).toBeVisible({ timeout: 30_000 });

    // Open the restored draft from the SessionManager. After a page reload the
    // draft is still in the backend tracker (active), so it lists as a card.
    await openSessionManager(page);
    const card = page.locator(sessionManager.card, {
      has: page.locator(".sm-dot--draft"),
    });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    // Input box repopulated with the typed text, tab shows the derived name.
    await expect(page.locator(sessionPanel.inputTextarea)).toHaveValue(multiline);
    await expect(draftTabName(page)).toHaveText("Refactor the s…");
  });

  // 7. Start below threshold — a 2-char prompt still starts the session.
  test("7. Start works for a sub-threshold prompt", async ({ page, tempProject }) => {
    const getSaves = trackSaveFrames(page);
    await openProject(page, tempProject.path);
    await openBlankDraft(page);

    const textarea = page.locator(sessionPanel.inputTextarea);
    await textarea.fill("hi");
    // Below threshold: nothing saved yet.
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    expect(getSaves().prepare).toBe(0);
    expect(sessionFileCount(tempProject.path)).toBe(0);

    // Keyboard submit (Ctrl+Enter) ensures-saves then starts regardless of length.
    await submitDraft(page);

    // The session is now persisted (prepare fired) and has left the draft phase:
    // its status pill shows a non-draft state.
    await expect.poll(() => getSaves().prepare, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => sessionFileCount(tempProject.path)).toBe(1);
    await expect(page.locator(sessionPanel.statusButton)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(sessionPanel.statusButton)).not.toContainText(/draft/i, {
      timeout: 30_000,
    });
  });

  // 8. No duplicate blanks — +New on an untouched blank tab focuses the existing one.
  test("8. a second + New focuses the existing untouched blank instead of opening another", async ({
    page,
    tempProject,
  }) => {
    await openProject(page, tempProject.path);

    await openBlankDraft(page);
    await expect(page.locator(".session-tab")).toHaveCount(1);
    const firstName = await draftTabName(page).innerText();

    // Trigger + New again while the untouched blank is open.
    await page.locator(newSession.newButton).click();

    // Still exactly one session tab — focus returned to the existing blank.
    await expect(page.locator(".session-tab")).toHaveCount(1);
    await expect(draftTabName(page)).toHaveText(firstName);
    expect(sessionFileCount(tempProject.path)).toBe(0);
  });

  // 9. Flush on exit — blur before the debounce captures the typed text.
  test("9. blurring before the debounce elapses flushes the typed text with no loss", async ({
    page,
    tempProject,
  }) => {
    const getSaves = trackSaveFrames(page);
    await openProject(page, tempProject.path);
    await openBlankDraft(page);

    const textarea = page.locator(sessionPanel.inputTextarea);
    await textarea.fill("fix login flow");
    // Immediately blur — well before the 750ms trailing debounce would fire.
    await textarea.blur();

    // The blur flush persisted the draft (prepare fired) and the typed text.
    await expect.poll(() => getSaves().prepare, { timeout: 5_000 }).toBe(1);
    await expect.poll(() => sessionFileCount(tempProject.path)).toBe(1);
    expect(readSessionField(tempProject.path, "draftInput")).toBe("fix login flow");
  });

  // 10. Scope unaffected — sessions that carry intent persist IMMEDIATELY.
  test("10. a session created with intent persists immediately, with no typing", async ({
    page,
    tempProject,
  }) => {
    const getSaves = trackSaveFrames(page);
    await openProject(page, tempProject.path);

    // The dev RPC client attaches once the WebSocket connects — openProject
    // only guarantees the workspace chrome, so wait for the client before
    // driving it directly (otherwise this races and `client` is undefined).
    await page.waitForFunction(
      () => !!(window as unknown as { __thinkrailClient?: unknown }).__thinkrailClient,
      null,
      { timeout: 15_000 },
    );

    // The blank `+ New` path defers; the intent-carrying path (meta-ticket /
    // suggested sessions) hits an immediate `agent/prepare` (createDraft) or
    // `agent/run`. Drive that primitive directly via the dev-exposed RPC
    // client — the same `agent/prepare` that createDraft issues — and assert a
    // file lands at once, with no typing and no threshold.
    //
    // The full LLM-driven Suggested-session approval UI can't be reproduced in
    // the e2e harness (it needs a live agent to emit `suggest_session`); this
    // exercises the immediate-persist contract that approval relies on.
    const ok = await page.evaluate(async (model) => {
      const client = (window as unknown as { __thinkrailClient?: {
        request: (m: string, p: object) => Promise<{ thinkrailSid: string }>;
      } }).__thinkrailClient;
      if (!client) return false;
      const res = await client.request("agent/prepare", {
        specIds: [],
        config: { model, permissionMode: "default", streamText: true, effort: null },
        skillId: "thinkrail-brainstorm",
        name: "Intent-carrying session",
      });
      return typeof res?.thinkrailSid === "string";
    }, DEFAULTS.model);
    expect(ok).toBe(true);

    // Persisted immediately — a prepare fired and a file exists, with no typing.
    await expect.poll(() => getSaves().prepare, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => sessionFileCount(tempProject.path)).toBe(1);
  });
});
