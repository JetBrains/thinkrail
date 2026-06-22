import { expect, type Page } from "@playwright/test";
import { chatStream, newSession, sessionPanel } from "./selectors";
import { pickOption, selectedLabel } from "./draftConfig";

/**
 * Open the New Session draft, pick a model via the DraftConfigCard dropdown,
 * type the prompt, and click Send. Does NOT wait for activity — call
 * waitForSessionActivity afterwards. `model` is a friendly label
 * (e.g. `{ label: "Sonnet 4.6" }`) so the test stays stable across id changes.
 */
export async function startSessionWithModel(
  page: Page,
  model: string | { label: string },
  prompt: string,
  opts?: { permissionMode?: string },
): Promise<void> {
  const label = typeof model === "string" ? model : model.label;
  await page.locator(newSession.newButton).click();
  await pickOption(page, "model", label);
  // The dropdown trigger settling on the chosen label proves the controlled
  // value updated (debounced `agent/updateDraft` round-trip landed).
  await expect(selectedLabel(page, "model")).toHaveText(label, { timeout: 30_000 });

  if (opts?.permissionMode) {
    await pickOption(page, "perms", opts.permissionMode);
    await expect(selectedLabel(page, "perms")).toHaveText(opts.permissionMode, { timeout: 30_000 });
  }

  const textarea = page.getByPlaceholder(newSession.promptInputPlaceholder);
  await textarea.fill(prompt);
  // Submit the draft via the keyboard chord — the Start/Send affordance is a
  // portaled generic <Button> now, so the documented Mod+Enter path is the
  // stable submit. `isMod` reads ctrlKey on Mac, altKey elsewhere.
  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  await textarea.press(`${isMac ? "Control" : "Alt"}+Enter`);
}

/**
 * Smoke variant: open a draft, pick a model, click the DraftConfigCard's
 * "▶ Start Session" button. The agent runs with an empty user message —
 * enough to verify the SDK round-trips for a given model. Use this for
 * model-connectivity coverage; use {@link startSessionWithModel} when the
 * prompt matters.
 */
export async function startSessionConnectivityCheck(
  page: Page,
  model: string | { label: string },
): Promise<void> {
  const label = typeof model === "string" ? model : model.label;
  await page.locator(newSession.newButton).click();
  await pickOption(page, "model", label);
  await expect(selectedLabel(page, "model")).toHaveText(label, { timeout: 30_000 });
  await page
    .getByRole(newSession.startButton.role, { name: newSession.startButton.name })
    .click();
}

/**
 * Wait for either an error banner or a sign of session activity (assistant text,
 * tool card, question card). Throws on error banner; returns peacefully on activity.
 */
export async function waitForSessionActivity(
  page: Page,
  timeoutMs = 90_000,
): Promise<void> {
  const errorBanner = page.locator(chatStream.errorBanner);
  const sessionActivity = page.locator(chatStream.activitySelectors);

  await expect
    .poll(
      async () =>
        (await errorBanner.count()) > 0 || (await sessionActivity.count()) > 0,
      {
        timeout: timeoutMs,
        message: "Session produced neither an error banner nor any chat activity in time",
      },
    )
    .toBe(true);

  if ((await errorBanner.count()) > 0) {
    const text = (await errorBanner.first().innerText()).trim();
    throw new Error(`Session hit an API error:\n${text}`);
  }
}

/**
 * Wait for the session status pill to settle into a non-running state ("idle"
 * after a turn completes, or "ended" after End session). Useful when the test
 * needs to send a follow-up message — the input is disabled while running.
 */
export async function waitForIdle(page: Page, timeoutMs = 90_000): Promise<void> {
  await expect(page.locator(sessionPanel.statusButton)).toContainText(
    /idle|ended|interrupted/i,
    { timeout: timeoutMs },
  );
}

/**
 * Click the InputArea's interrupt button. The button is only rendered while
 * the session is in a running state (canInterrupt + onInterrupt), so the
 * caller is expected to time the click during an active turn.
 */
export async function interruptSession(page: Page): Promise<void> {
  await page.locator(sessionPanel.inputInterrupt).click();
}

/**
 * End the focused session via the SessionStatusLine status dropdown.
 */
export async function endSession(page: Page): Promise<void> {
  const statusBtn = page.locator(sessionPanel.statusButton);
  if ((await statusBtn.count()) === 0) return;
  // The button is disabled once the session is already done/error — bail out.
  if (await statusBtn.isDisabled().catch(() => true)) return;
  await statusBtn.click();
  const endItem = page.locator(sessionPanel.statusDropdownItem, {
    hasText: /End session/i,
  });
  if ((await endItem.count()) > 0) {
    await endItem.first().click();
    await expect(statusBtn).toContainText(/ended/i, { timeout: 30_000 });
  } else {
    // Already ended — close the menu.
    await page.keyboard.press("Escape");
  }
}
