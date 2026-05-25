import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedSessionDefaults } from "../helpers/appSettings";
import { inputAutocomplete, newSession } from "../helpers/selectors";

/**
 * Slash autocomplete in the chat composer — mid-input trigger + grouped
 * (Bonsai + active runtime) popup.
 *
 * Locks in the behaviour described in
 * `.bonsai/runtime-skills-autocomplete/design-doc.md` §3 (UX) and §8.3
 * (e2e plan):
 *
 *  - `/` after whitespace mid-textarea opens the popup (not just at the
 *    start of input).
 *  - Two sections render: "Bonsai" first, then the active runtime's
 *    `displayName` ("Claude Code") — assertions match on **visible text**,
 *    not value, per the e2e-model-picker memory note.
 *  - ArrowDown crosses the section boundary into the runtime group.
 *  - Tab inserts ``/skill-id `` at the caret, preserving prefix and suffix.
 *  - Ctrl/Alt+Enter submits the draft and the user message lands in chat
 *    (per the start-draft-submit memory note — keyboard, never the Start
 *    button).
 *
 * The runtime section is guaranteed to be non-empty in any environment
 * because the Claude runtime ships `init`, `review`, and `security-review`
 * as `_BUILTIN_SKILLS` in `backend/app/agent/runtime/claude/runtime.py`.
 * That keeps the spec independent of the developer's `~/.claude/skills/`
 * contents — important for CI determinism.
 *
 * Per the AppStore-isolation memory note, we seed `session_defaults`
 * explicitly so the spec doesn't rely on whatever the user's previous
 * runs left in `~/.bonsai/bonsai.db`. The seeded model resolves through
 * the Claude runtime, which makes the effective runtime — and therefore
 * the second section header — `"Claude Code"`.
 */

// Bonsai's `isMod` returns ctrlKey on macOS and altKey elsewhere
// (`frontend/src/utils/platform.ts::IS_MAC` is derived from
// `navigator.userAgent`).  Playwright's `Desktop Chrome` device pins
// the userAgent to a `Windows NT` string regardless of the host OS, so
// `IS_MAC` is **always `false`** inside the test browser — i.e. Alt+Enter
// is the correct submit chord on macOS and Linux runners alike.  Using
// `process.platform === "darwin"` here would pick Control+Enter on
// macOS hosts and silently no-op the submit (as a real session, not
// the test, would correctly fall through to a newline insert).
const SUBMIT_CHORD = "Alt+Enter";

test("slash autocomplete: mid-input trigger, grouped sections, Tab insertion, keyboard submit", async ({
  page,
  tempProject,
}) => {
  // Seed user-scoped session defaults BEFORE opening the project, per the
  // AppStore-isolation memory note.
  await seedSessionDefaults(tempProject.path, {
    model: "claude-haiku-4-5-20251001",
    permissionMode: "default",
    effort: null,
    maxTurns: 20,
  });

  await openProject(page, tempProject.path);

  // Spawn a draft via the header "+ New" button so the InputArea textarea
  // is in the DOM (placeholder: "Type a message to start...").
  await page.locator(newSession.newButton).click();
  const textarea = page.getByPlaceholder(newSession.promptInputPlaceholder);
  await expect(textarea).toBeVisible({ timeout: 15_000 });

  // ── Mid-input trigger: `/` after whitespace opens the popup ─────────────
  // The leading "Some context " ensures the active `/` is preceded by
  // whitespace, not by start-of-input — proving the mid-input trigger
  // works (i.e. we don't regress to the old "only at index 0" behaviour).
  await textarea.fill("Some context /");
  await textarea.focus();

  const bonsaiHeader = page.locator(inputAutocomplete.sectionHeader, {
    hasText: "Bonsai",
  });
  const runtimeHeader = page.locator(inputAutocomplete.sectionHeader, {
    hasText: "Claude Code",
  });
  // Section headers asserted by visible text, not value — see the
  // e2e-model-picker memory note.
  await expect(bonsaiHeader).toBeVisible({ timeout: 15_000 });
  await expect(runtimeHeader).toBeVisible({ timeout: 15_000 });

  // Bonsai section is rendered first in DOM order; runtime section
  // ("Claude Code") second.
  const firstGroup = page.locator(inputAutocomplete.group).first();
  const secondGroup = page.locator(inputAutocomplete.group).nth(1);
  await expect(firstGroup.locator(inputAutocomplete.sectionHeader)).toHaveText(
    "Bonsai",
  );
  await expect(secondGroup.locator(inputAutocomplete.sectionHeader)).toHaveText(
    "Claude Code",
  );

  // ── ArrowDown crosses the section boundary ──────────────────────────────
  // The hook starts with the first Bonsai item highlighted.  Pressing
  // ArrowDown `bonsaiCount` times walks past the last Bonsai item and into
  // the runtime section.
  const bonsaiCount = await firstGroup.locator(inputAutocomplete.item).count();
  expect(
    bonsaiCount,
    "expected at least one Bonsai skill in the first group",
  ).toBeGreaterThan(0);

  // Sanity: the active item starts inside the Bonsai group.
  await expect(firstGroup.locator(inputAutocomplete.active)).toHaveCount(1);

  for (let i = 0; i < bonsaiCount; i++) {
    await textarea.press("ArrowDown");
  }

  // After `bonsaiCount` ArrowDowns the active item must sit in the
  // runtime group; the Bonsai group should no longer hold any active item.
  await expect(secondGroup.locator(inputAutocomplete.active)).toHaveCount(1);
  await expect(firstGroup.locator(inputAutocomplete.active)).toHaveCount(0);

  // Close the popup before the next step so we start from a clean state
  // and don't rely on the previous selectedIndex.
  await textarea.press("Escape");
  await expect(page.locator(inputAutocomplete.popup)).toHaveCount(0);

  // ── Tab inserts `/spec-status `, preserving prefix ──────────────────────
  // The substring `spec-stat` is a unique filter — among the Bonsai skills
  // it matches only `spec-status` (and none of the Claude built-ins).
  // That makes Tab acceptance deterministic regardless of how many
  // additional spec-* skills the project ships.
  await textarea.fill("Some context /spec-stat");

  // Only the Bonsai section should be present (no runtime built-in matches
  // "spec-stat") and it should contain `/spec-status`.
  await expect(page.locator(inputAutocomplete.group)).toHaveCount(1);
  await expect(
    page.locator(inputAutocomplete.item, { hasText: "/spec-status" }),
  ).toBeVisible({ timeout: 10_000 });

  // Tab accepts the highlighted (and only) suggestion. The hook's
  // replacement is `/spec-status ` spliced into the active /token range,
  // with the prefix `"Some context "` preserved verbatim.
  await textarea.press("Tab");

  await expect(textarea).toHaveValue("Some context /spec-status ");

  // ── Keyboard submit (Ctrl/Alt+Enter) lands the user message ─────────────
  // Per the start-draft-submit memory note: the Start button is portal-
  // rendered into a slot that only mounts for non-draft sessions, so
  // drafts must be submitted via Ctrl/Alt+Enter on the textarea instead.
  // After submission `handleSend` clears the textarea and dispatches the
  // user message into the chat stream where it renders as `.chat-user-text`.
  await textarea.press(SUBMIT_CHORD);

  // The submitted message text equals the textarea content with the
  // trailing space trimmed (`onSend(trimmed, true)` in `InputArea.tsx`).
  // The user bubble renders as markdown by default (`isMarkdown=true`)
  // inside `.chat-user-text--md`; `.chat-user` is the bubble wrapper that
  // covers both the markdown and the "raw" toggle views.
  await expect(
    page.locator(".chat-user", { hasText: "Some context /spec-status" }),
  ).toBeVisible({ timeout: 15_000 });
});
