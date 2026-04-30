import { expect, type Locator, type Page } from "@playwright/test";
import { chatStream, newSession, sessionPanel } from "./selectors";

/**
 * Poll a `<select>` until it contains an option with the given value. The
 * dynamic Anthropic model list arrives after the first WS frame, so on a
 * fresh page the dropdown briefly carries only the static fallback set.
 */
async function waitForOptionValue(
  select: Locator,
  value: string,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        select.evaluate(
          (el: HTMLSelectElement, v: string) =>
            Array.from(el.options).some((o) => o.value === v),
          value,
        ),
      { timeout: timeoutMs, message: `<option value="${value}"> never appeared` },
    )
    .toBe(true);
}

/** Same as {@link waitForOptionValue} but matches by visible text. */
async function waitForOptionLabel(
  select: Locator,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        select.evaluate(
          (el: HTMLSelectElement, l: string) =>
            Array.from(el.options).some((o) => o.text.trim() === l),
          label,
        ),
      { timeout: timeoutMs, message: `<option> with label "${label}" never appeared` },
    )
    .toBe(true);
}

/**
 * Resolve a model select option's `value` attribute by its visible label.
 * Used so we can `toHaveValue(...)` after the round-trip — the DraftConfigCard
 * select is controlled (`value={session.model}`), so its reported value only
 * reflects the new model once `agent/updateDraft` has landed and the store
 * updated. Polling the value gives us a real settle signal instead of a sleep.
 */
async function resolveOptionValueByLabel(
  select: Locator,
  label: string,
): Promise<string> {
  const value = await select.evaluate(
    (el: HTMLSelectElement, l: string) =>
      Array.from(el.options).find((o) => o.text.trim() === l)?.value ?? "",
    label,
  );
  if (!value) throw new Error(`No <option> matches label "${label}"`);
  return value;
}

/**
 * Open the New Session draft, pick a model, type the prompt, and click Start.
 * Does NOT wait for activity — call waitForSessionActivity afterwards.
 *
 * `model` may be either a model id (e.g. "claude-haiku-4-5-20251001") or
 * `{ label: "Haiku 4.5" }`. Prefer label-based selection when the test should
 * be agnostic to whether the dynamic model list (Anthropic API ids like
 * "claude-haiku-4-5-20251001") or the static fallback ("claude-haiku-4-5")
 * is in use.
 */
export async function startSessionWithModel(
  page: Page,
  model: string | { label: string },
  prompt: string,
  opts?: { permissionMode?: string },
): Promise<void> {
  await page.locator(newSession.newButton).click();

  const modelSelect = page.locator(newSession.modelSelect);
  await expect(modelSelect).toBeVisible();
  let resolvedModelValue: string;
  if (typeof model === "string") {
    await waitForOptionValue(modelSelect, model);
    resolvedModelValue = model;
  } else {
    await waitForOptionLabel(modelSelect, model.label);
    resolvedModelValue = await resolveOptionValueByLabel(modelSelect, model.label);
  }
  await modelSelect.selectOption(resolvedModelValue);
  // The DraftConfigCard debounces every config edit by 300ms before round-
  // tripping it through `agent/updateDraft`. The select is controlled by
  // `session.model`, so its value only stabilises on the chosen option once
  // the round-trip lands and the store re-renders. Polling toHaveValue is the
  // correct settle signal — a fixed sleep can let Start fire with the old
  // model on a loaded backend.
  await expect(modelSelect).toHaveValue(resolvedModelValue, { timeout: 30_000 });

  if (opts?.permissionMode) {
    const permSelect = page.locator(newSession.permissionSelect);
    await permSelect.selectOption(opts.permissionMode);
    // Same controlled-select round-trip story as the model picker above.
    await expect(permSelect).toHaveValue(opts.permissionMode, { timeout: 30_000 });
  }

  await page.getByPlaceholder(newSession.promptInputPlaceholder).fill(prompt);
  // The InputArea's send button (text "Start" while the session is a draft)
  // actually flows the typed prompt through to the first agent turn. The
  // DraftConfigCard's "▶ Start Session" button also starts the session, but
  // with an empty user message — useful for connectivity smoke tests, not for
  // tests that depend on the agent acting on the prompt.
  await page.locator("button.input-send").click();
}

/**
 * Smoke variant: open a draft, pick a model, click the DraftConfigCard's
 * "▶ Start Session" button. The agent runs with an empty user message —
 * sufficient to verify the SDK round-trips for a given model id, but the
 * agent never sees the test's prompt. Use this for model-connectivity
 * coverage; use {@link startSessionWithModel} when the prompt matters.
 */
export async function startSessionConnectivityCheck(
  page: Page,
  model: string | { label: string },
): Promise<void> {
  await page.locator(newSession.newButton).click();
  const modelSelect = page.locator(newSession.modelSelect);
  await expect(modelSelect).toBeVisible();
  let resolvedModelValue: string;
  if (typeof model === "string") {
    await waitForOptionValue(modelSelect, model);
    resolvedModelValue = model;
  } else {
    await waitForOptionLabel(modelSelect, model.label);
    resolvedModelValue = await resolveOptionValueByLabel(modelSelect, model.label);
  }
  await modelSelect.selectOption(resolvedModelValue);
  // Wait for the controlled select's value to settle on the chosen option —
  // proves `agent/updateDraft` round-tripped and the store now carries the
  // selected model. See the analogous comment in startSessionWithModel.
  await expect(modelSelect).toHaveValue(resolvedModelValue, { timeout: 30_000 });
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
