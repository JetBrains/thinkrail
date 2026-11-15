import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat, revealWorkbenchTool, waitForAgentSettled } from "./fixtures/app";

const OUTSIDE = "/tmp/thinkrail-artifacts-live";

test("an agent's output stays in the workspace: a temp-folder write lands in artifacts and a run's ignored output is listed", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	rmSync(OUTSIDE, { recursive: true, force: true });
	const workspace = await openWorkspaceChat(page);
	writeFileSync(join(workspace.worktreePath, ".gitignore"), "out/\n");
	await page
		.getByTestId("chat-input")
		.fill(
			`Do exactly these two things and nothing else. 1) Use the write tool to save a file at ${OUTSIDE}/summary.md whose only line is: hello. If that write is refused, follow the refusal's advice and keep the file name summary.md. 2) Run this shell command: mkdir -p out && echo built > out/result.txt`,
		);
	await page.getByTestId("chat-send").click();
	await waitForAgentSettled(page, 210_000);

	expect(existsSync(join(OUTSIDE, "summary.md"))).toBe(false);
	await revealWorkbenchTool(page, "artifacts");
	const summary = page.locator(
		'[data-testid="artifact-row"][data-path=".thinkrail/context/summary.md"]',
	);
	await expect(summary).toBeVisible({ timeout: 15_000 });
	await expect(summary.getByTestId("artifact-chat")).toBeVisible();
	await expect(page.locator('[data-testid="artifact-output"][data-path="out"]')).toContainText(
		"1 file",
	);
});
