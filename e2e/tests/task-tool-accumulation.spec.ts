import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openProject } from "../helpers/project";
import {
  startSessionWithModel,
  waitForSessionActivity,
  waitForIdle,
} from "../helpers/session";
import { sessionPanel } from "../helpers/selectors";

/**
 * The SDK emits `TaskCreate` and per-state `TaskUpdate` calls; the frontend
 * accumulator must collapse them into a single consolidated card. This spec
 * drives a 3-step plan + status flips and asserts one card with three items.
 *
 * Real LLM call → tagged slow.
 */
test("TaskCreate/TaskUpdate stream collapses into one consolidated card", async ({
  page,
  tempProject,
}) => {
  test.slow();
  // Drop any non-dot file at root so the backend classifies this as an
  // "existing" project — otherwise the empty tempProject lands in the
  // new-project wizard instead of the normal AppShell.
  writeFileSync(join(tempProject.path, "README.md"), "# task-card e2e\n", "utf8");
  await openProject(page, tempProject.path);

  // Sonnet 4.6 + bypassPermissions: Task tools fire without prompts. Haiku
  // 4.5's static fallback id `claude-haiku-4-5` is rejected by the API
  // (requires the dated form), so use Sonnet whose undated id is accepted.
  await startSessionWithModel(
    page,
    { label: "Sonnet 4.6" },
    "I am testing task tracking. Please do exactly this and nothing else:\n" +
      "1) Call TaskCreate three times with subjects 'first', 'second', 'third'.\n" +
      "2) Call TaskUpdate to mark task #1 in_progress, then completed.\n" +
      "3) Call TaskUpdate to mark task #2 in_progress, then completed.\n" +
      "4) Call TaskUpdate to mark task #3 in_progress, then completed.\n" +
      "Do not edit, read, or run anything else. After all updates, reply 'done'.",
    { permissionMode: "bypassPermissions" },
  );

  // Wait for the agent to start emitting tool calls.
  await waitForSessionActivity(page);

  // The consolidated card is a `.chat-tool` whose header reads "Tasks" and
  // whose body holds a `.task-list`. There must be exactly one such card,
  // even though the agent emitted three TaskCreate + multiple TaskUpdate
  // calls — that's the point of the accumulator.
  const tasksCard = page.locator(".chat-tool", { has: page.locator(".task-list") });
  await expect(tasksCard).toHaveCount(1, { timeout: 90_000 });

  // Wait for completion so the final state is stable before we count items.
  await waitForIdle(page);

  // All three items present.
  await expect(tasksCard.locator(".task-item")).toHaveCount(3);

  const headerText = await tasksCard.locator(".chat-tool-input").innerText();
  expect(headerText).toMatch(/\d+ of 3 done/);
  await expect(tasksCard.locator(".task-item--completed")).toHaveCount(3);

  await expect(page.locator(".chat-tool-name", { hasText: /^Tasks$/ })).toHaveCount(1);
  await expect(page.locator(".chat-tool-name", { hasText: /^Task Created/ })).toHaveCount(0);
  await expect(page.locator(".chat-tool-name", { hasText: /^Task #/ })).toHaveCount(0);

  // The accumulator is session-scoped (anchored at the first Task* event in
  // the stream), so a second turn must extend the existing card. The SDK's
  // task id counter persists across turns, so new tasks land as #4 and #5.
  const textarea = page.locator(sessionPanel.inputTextarea);
  await textarea.fill(
    "Follow-up turn. Do exactly this and nothing else:\n" +
      "1) Call TaskCreate twice with subjects 'fourth' and 'fifth'.\n" +
      "2) Call TaskUpdate to mark task #4 in_progress, then completed.\n" +
      "3) Call TaskUpdate to mark task #5 in_progress, then completed.\n" +
      "Do not delete or modify the earlier three tasks. After all updates, reply 'done'.",
  );
  await page.locator(sessionPanel.inputSend).click();

  await waitForSessionActivity(page);
  await waitForIdle(page);

  await expect(tasksCard).toHaveCount(1);
  await expect(tasksCard.locator(".task-item")).toHaveCount(5);
  await expect(tasksCard.locator(".task-item--completed")).toHaveCount(5);
  expect(await tasksCard.locator(".chat-tool-input").innerText()).toMatch(/\d+ of 5 done/);
  await expect(page.locator(".chat-tool-name", { hasText: /^Tasks$/ })).toHaveCount(1);
});
