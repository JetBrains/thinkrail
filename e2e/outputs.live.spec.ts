import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat, revealWorkbenchTool, waitForAgentSettled } from "./fixtures/app";

const CONTEXT = ".thinkrail/context";

test("an agent publishes the mockup it made, not its draft, and Outputs lists only that", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	const workspace = await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			`Make a tiny static HTML mockup of a login form for me. First save a rough draft at ${CONTEXT}/mockups/login/_work/draft.html, then the finished page at ${CONTEXT}/mockups/login/index.html. Keep both files tiny, do not open or preview them, and then hand the result to me.`,
		);
	await page.getByTestId("chat-send").click();
	await waitForAgentSettled(page, 210_000);

	expect(existsSync(join(workspace.worktreePath, CONTEXT, "mockups/login/index.html"))).toBe(true);
	expect(existsSync(join(workspace.worktreePath, CONTEXT, "mockups/login/_work/draft.html"))).toBe(
		true,
	);
	const card = page.getByTestId("tool-present-file");
	await expect(card).toHaveCount(1);
	await expect(card).toHaveAttribute("data-path", `${CONTEXT}/mockups/login/index.html`);

	await revealWorkbenchTool(page, "artifacts");
	await expect(page.getByTestId("artifacts-view")).toHaveAttribute("data-view", "outputs");
	const rows = page.getByTestId("artifact-output-file");
	await expect(rows).toHaveCount(1, { timeout: 15_000 });
	await expect(rows).toHaveAttribute("data-path", `${CONTEXT}/mockups/login/index.html`);
	await expect(page.getByTestId("turn-divider-artifacts")).toHaveText("1 artifact");
});
