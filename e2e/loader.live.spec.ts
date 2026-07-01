import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent: excluded from the default `bun run e2e`; run via `bun run e2e:agent` / `e2e:full`.
// Drives a REAL pi agent (see agent.live.spec.ts for the auth note). Guards the streaming loader:
//   1. it fills the post-send gap and names the phase while a tool runs, and
//   2. it fully disappears when the turn ends — no stray live indicator lingers in the transcript.
test("the streaming loader shows a phase mid-turn and clears on done", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(90_000); // real provider latency varies — don't fail on a slow turn under the 30s default
	await openWorkspaceChat(page);

	// A tool-running prompt guarantees a multi-second, multi-message turn (thinking → bash → answer), so the
	// loader is reliably observable rather than flashing past a single-poll assertion.
	await page
		.getByTestId("chat-input")
		.fill("Use bash to run `sleep 2 && echo marker-42`, then tell me exactly what it printed.");
	await page.getByTestId("chat-send").click();

	// The loader must appear (the gap is covered) and, while the tool executes, name the phase.
	const loader = page.getByTestId("stream-indicator");
	await expect(loader).toBeVisible({ timeout: 60_000 });
	await expect(
		page.locator('[data-testid="stream-indicator"][data-phase="running-tool"]'),
	).toBeVisible({ timeout: 60_000 });

	// Turn concludes: a non-empty assistant reply lands and streaming ends (the Stop button goes away).
	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
	await expect(assistant).not.toBeEmpty({ timeout: 60_000 });
	await expect(page.getByTestId("chat-abort")).toHaveCount(0, { timeout: 60_000 });

	// …and the loader is gone. No blinking-cursor glyph survives anywhere in the transcript (the regression
	// this replaced left one `▍` per un-terminated assistant message after "✓ Done").
	await expect(loader).toHaveCount(0);
	await expect(page.getByTestId("chat-scroll").getByText("▍")).toHaveCount(0);
});
