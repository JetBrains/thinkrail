import { resolve } from "node:path";
import { test, expect } from "../fixtures/admin";

const REPO_ROOT = resolve(__dirname, "..", "..");

const MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

for (const model of MODELS) {
  test(`new session with ${model.label} starts without API error`, async ({ page, admin }) => {
    await page.goto("/");

    // Login.
    await page.getByPlaceholder("bns_...").fill(admin.token);
    await page.getByRole("button", { name: "Login" }).click();

    // Open project at the repo root.
    const pathInput = page.getByPlaceholder("/home/user/my-project");
    await expect(pathInput).toBeVisible();
    await pathInput.fill(REPO_ROOT);
    // The path-suggestion popover overlaps the Open Project button — dismiss it.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open Project" }).click();

    // Wait for the project shell to settle (status bar appears once WS is connected).
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible();

    // Open the New Session draft (top-right header "+ New" button — header-btn-primary).
    await page.locator("button.header-btn-primary", { hasText: "+ New" }).click();

    // The draft form's model dropdown.
    const modelSelect = page.locator("select.draft-config-select--model");
    await expect(modelSelect).toBeVisible();
    await modelSelect.selectOption(model.id);
    await expect(modelSelect).toHaveValue(model.id);

    // Type a tiny prompt and start.
    await page
      .getByPlaceholder(/Type a message to start/)
      .fill("Hi");
    await page.getByRole("button", { name: /Start Session/ }).click();

    // After Start, the SDK either errors (failure) or the session begins
    // producing output: an assistant text message, a tool call, or a question
    // card. Wait for whichever signal lands first within 90s.
    const errorBanner = page.locator(".chat-banner-error");
    const sessionActivity = page.locator(
      ".chat-assistant, .chat-tool, .chat-question, .chat-question-answered-table",
    );

    await expect
      .poll(
        async () =>
          (await errorBanner.count()) > 0 || (await sessionActivity.count()) > 0,
        {
          timeout: 90_000,
          message: `Session for ${model.label} produced neither an error banner nor any chat activity within 90s`,
        },
      )
      .toBe(true);

    if ((await errorBanner.count()) > 0) {
      const text = (await errorBanner.first().innerText()).trim();
      throw new Error(
        `Session for ${model.label} (${model.id}) hit an API error:\n${text}`,
      );
    }
  });
}
