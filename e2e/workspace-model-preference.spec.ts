import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { activeWorktreeRow, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const REASONER_ID = "e2e-sticky-reasoner";
const REASONER_NAME = "E2E Sticky Reasoner";
const BASIC_ID = "e2e-sticky-basic";
const BASIC_NAME = "E2E Sticky Basic";

function persistedWorktree(): Workspace {
	const workspaces = JSON.parse(
		readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8"),
	) as Workspace[];
	const workspace = workspaces.find((candidate) => candidate.kind !== "default");
	if (!workspace) throw new Error("persisted worktree missing");
	return workspace;
}

function activeModelSelector(page: Page) {
	return page.locator('[data-testid="model-selector"]:visible');
}

function activeThinkingSelector(page: Page) {
	return page.locator('[data-testid="thinking-selector"]:visible');
}

async function chooseModel(page: Page, id: string): Promise<void> {
	await activeModelSelector(page).click();
	await page.locator(`[data-testid="model-option"][data-model-id="${id}"]`).click();
}

async function expectActiveSelection(page: Page, model: string, level: string): Promise<void> {
	await expect(activeModelSelector(page)).toContainText(model);
	await expect(activeThinkingSelector(page)).toContainText(level);
}

test("a workspace reuses the last effective model and thinking pair for future chats", {
	tag: "@dev-seam",
}, async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("model-selector")).toContainText("Default model");

	await chooseModel(page, REASONER_ID);
	await activeThinkingSelector(page).click();
	await page.locator('[data-testid="thinking-option"][data-level="xhigh"]').click();
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	await expectActiveSelection(page, REASONER_NAME, "xhigh");
	await expect
		.poll(() => {
			const workspace = persistedWorktree();
			return `${workspace.model?.id}:${workspace.thinkingLevel}`;
		})
		.toBe(`${REASONER_ID}:xhigh`);

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(2);
	await expectActiveSelection(page, REASONER_NAME, "xhigh");

	await chooseModel(page, BASIC_ID);
	await expectActiveSelection(page, BASIC_NAME, "off");
	await expect
		.poll(() => {
			const workspace = persistedWorktree();
			return `${workspace.model?.id}:${workspace.thinkingLevel}`;
		})
		.toBe(`${BASIC_ID}:off`);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	const restoredCount = await chatTabs.count();
	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(restoredCount + 1);
	await expectActiveSelection(page, BASIC_NAME, "off");
});
