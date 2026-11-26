import { existsSync, readdirSync, readFileSync } from "node:fs";
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

test("an agent honors an explicit output directory without publishing an artifact copy", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	const workspace = await openWorkspaceChat(page);
	const destination = "reports/explicit-destination.md";
	await page
		.getByTestId("chat-input")
		.fill(
			`Create a Markdown report whose only line is EXPLICIT_DESTINATION_OK. Save it at ${destination} in this project, then hand me that file.`,
		);
	await page.getByTestId("chat-send").click();
	await waitForAgentSettled(page, 210_000);

	expect(readFileSync(join(workspace.worktreePath, destination), "utf8").trim()).toBe(
		"EXPLICIT_DESTINATION_OK",
	);
	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
	await expect(
		assistant.locator(`[data-testid="chat-file-link"][data-path="${destination}"]`),
	).toBeVisible();
	await expect(page.getByTestId("tool-present-files")).toHaveCount(0);
	const artifactsDir = join(workspace.worktreePath, CONTEXT);
	const artifactFiles = existsSync(artifactsDir)
		? readdirSync(artifactsDir, { recursive: true, encoding: "utf8" })
		: [];
	expect(artifactFiles.filter((path) => path.endsWith("explicit-destination.md"))).toEqual([]);
});
