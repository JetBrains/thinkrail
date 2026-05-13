import { test, expect } from "../fixtures";
import { appShell, projectPicker } from "../helpers/selectors";

/**
 * Project init flow: opening a brand-new (unininitialized) directory surfaces
 * NewProjectScreen inside SessionPanel. We only assert the rejection path here
 * — the happy path requires a real Anthropic session.
 */

test("NewProjectScreen rejects an empty project name", async ({
  page,
  tempProject,
}) => {
  await page.goto("/");

  const pathInput = page.locator(projectPicker.pathInput);
  await pathInput.fill(tempProject.path);
  await page.keyboard.press("Escape");
  await page
    .getByRole(projectPicker.openButton.role, { name: projectPicker.openButton.name })
    .click();
  await expect(page.getByText(appShell.statusSessionsLabel)).toBeVisible({ timeout: 30_000 });

  // The "Define Goals" button enables once the prompt is non-empty, but
  // clicking it without a project name surfaces an inline validation error
  // and does not start the session.
  const promptArea = page.locator("textarea.welcome-textarea");
  await expect(promptArea).toBeVisible();
  await promptArea.fill("Build something cool");

  const startBtn = page.getByRole("button", { name: /Define Goals/ });
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  await expect(page.locator(".np-name-error")).toBeVisible();
  await expect(page.locator(".welcome-name-input--error")).toBeVisible();
  // Still on the goal-entry form — no session was started.
  await expect(page.getByText("What are your project goals?")).toBeVisible();
});
