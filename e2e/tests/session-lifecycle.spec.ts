import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import {
  endSession,
  interruptSession,
  startSessionWithModel,
  waitForIdle,
  waitForSessionActivity,
} from "../helpers/session";
import { chatStream, sessionPanel } from "../helpers/selectors";

/**
 * Real-LLM session lifecycle smoke. Uses Haiku (cheapest) and runs serially
 * so concurrent SDK traffic doesn't flake.
 */

const HAIKU = { label: "Haiku 4.5" } as const;

test.describe.configure({ mode: "serial" });

test.describe("Session lifecycle", () => {
  test("start, follow-up, end without error banner", async ({
    page,
    tempProject,
  }) => {
    test.slow();
    await openProject(page, tempProject.path);

    await startSessionWithModel(page, HAIKU, "Reply with just 'hi'.");
    await waitForSessionActivity(page);

    // Wait for the model to finish its turn — input re-enables when status leaves running.
    await waitForIdle(page);

    // Send a follow-up — the input area should be enabled.
    const textarea = page.getByPlaceholder(sessionPanel.messagePlaceholder);
    await expect(textarea).toBeEnabled({ timeout: 60_000 });
    await textarea.fill("Reply with just one word.");
    await page.locator(sessionPanel.inputSend).click();

    // Wait for at least 2 assistant text blocks (one per turn).
    await expect(page.locator(".chat-assistant")).toHaveCount(2, {
      timeout: 90_000,
    });

    // End the session via the status-line dropdown.
    await waitForIdle(page);
    await endSession(page);

    // No error banner appeared during the entire flow.
    await expect(page.locator(chatStream.errorBanner)).toHaveCount(0);
  });

  test("triggers a tool call (chat-tool card surfaces)", async ({
    page,
    tempProject,
  }) => {
    test.slow();
    await openProject(page, tempProject.path);

    // bypassPermissions lets the agent invoke shell tools without prompting,
    // keeping this test deterministic — we only need to prove a tool card
    // *appears*, not that any approval flow works (covered separately).
    await startSessionWithModel(
      page,
      HAIKU,
      "Use the Bash tool to run `pwd` and report what it printed.",
      { permissionMode: "bypassPermissions" },
    );

    await expect(page.locator(chatStream.toolCard).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator(chatStream.errorBanner)).toHaveCount(0);
  });

  test("interrupt mid-turn surfaces interrupted system message", async ({
    page,
    tempProject,
  }) => {
    test.slow();
    await openProject(page, tempProject.path);

    // A long-running prompt is essential: the InputArea's interrupt button
    // is rendered only while session status is "running" or "waiting"
    // (canInterrupt). If Haiku finishes the turn quickly, the button
    // disappears before we can click. Asking for a long, structured output
    // keeps the turn alive long enough to land an interrupt; the agent
    // never has to actually finish for the assertion to hold.
    await startSessionWithModel(
      page,
      HAIKU,
      "Write a 1000-word essay about the history of trees. Use complete sentences and take your time. After the essay, list 100 numbered facts about forests, each on its own line.",
    );

    // Wait for the interrupt button itself instead of any chat output — the
    // button appears as soon as status flips to running, before the first
    // streamed chunk. Waiting for assistant text first leaves a race where
    // the model can finish between the chunk and the click on a fast turn.
    const interruptBtn = page.locator(sessionPanel.inputInterrupt);
    await expect(interruptBtn).toBeVisible({ timeout: 30_000 });
    await interruptSession(page);

    // The runner emits `agent/interrupted` and then immediately returns the
    // session to `idle` — there is no terminal "interrupted" status pill.
    // The frontend renders the `interrupted` event as a system message
    // ("Turn interrupted") and re-enables the input. Assert on both:
    //   - the system message proves the `agent/interrupt` RPC +
    //     `agent/interrupted` notification round-trip landed
    //   - the textarea re-enabling proves status flipped back to idle
    await expect(
      page.locator(".chat-system", { hasText: "Turn interrupted" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByPlaceholder(sessionPanel.messagePlaceholder))
      .toBeEnabled({ timeout: 30_000 });
    await expect(page.locator(chatStream.errorBanner)).toHaveCount(0);
  });
});
