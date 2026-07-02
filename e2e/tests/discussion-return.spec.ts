import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import { seedDeliverable } from "../helpers/board";
import { startSessionWithModel, waitForSessionActivity } from "../helpers/session";
import { sessionPanel } from "../helpers/selectors";

/**
 * Discussion subsession → "Return to parent".
 *
 * A discussion subsession (branched via `/discuss`) shows a persistent
 * "Return to parent" banner. Opening it presents a dialog offering "Return with
 * a result" (an agent-drafted, editable summary) or "Return without a result".
 * This spec drives the deterministic path — return WITHOUT a result — asserting
 * on the banner/dialog UI, the message-origin target label, and the lifecycle
 * (switch back to parent + the child `↳` tab closes). It avoids asserting on the
 * agent's drafted summary, which is nondeterministic; the origin-aware routing
 * of a returned result is covered by store unit tests
 * (`frontend/src/store/__tests__/sessionStore.return.test.ts`).
 */

const ARROW = "↳"; // subsession nesting prefix in the SessionTabBar

test("a discussion subsession returns to its parent without a result", async ({
  page,
  tempProject,
}) => {
  test.slow(); // involves real agent turns

  // Mark the project initialized so it opens straight into the sessions
  // workspace instead of the onboarding wizard (which has no New-session button).
  seedDeliverable(tempProject.path);
  await openProject(page, tempProject.path);

  // Parent session. Constrain the agent so it settles to idle without asking a
  // question (a pending question would replace the main input the /discuss
  // command needs). Haiku for speed.
  await startSessionWithModel(
    page,
    { label: "Haiku 4.5" },
    "Reply with the single word: ready. Do not ask questions and do not use any tools.",
  );
  await waitForSessionActivity(page);
  await expect(page.locator(sessionPanel.statusButton)).toContainText(/idle/i, {
    timeout: 90_000,
  });

  // Branch a discussion subsession off the parent via /discuss. It auto-starts
  // (no explicit Start) and hides its draft config.
  await page
    .locator(sessionPanel.inputTextarea)
    .fill("/discuss where to store OAuth tokens");
  await page.locator(sessionPanel.inputSend).click();

  // Auto-start: the "Return to parent" banner mounts on its own — no Start click —
  // and no draft "Start Session" button is ever shown.
  const banner = page.locator(".return-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Start Session/ })).toHaveCount(0);

  // Open the return dialog from the banner.
  await banner.getByRole("button", { name: /Return to parent/ }).click();
  const dialog = page.locator(".return-dialog");
  await expect(dialog).toBeVisible();

  // Launched from /discuss → the result would land in the parent's message box.
  await expect(dialog.locator(".return-dialog-target")).toContainText(/message box/i);

  // Return without a result → switch to parent, child tab closes.
  await dialog.getByRole("button", { name: /Return without a result/ }).click();

  await expect(
    page.locator(".session-tab-name").filter({ hasText: ARROW }),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.locator(".session-tab").filter({ hasText: /Reply with/i }),
  ).toHaveCount(1);
});
