import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
const addIcon = (page: Page) => page.locator('[data-testid="review-add-icon"]:visible');

test("a review send reads back from the chat: summary → file → comment + fragment, disk reopen included", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	writeFileSync(
		join(worktree(), "script.ts"),
		"export const one = 1;\nexport const two = 2;\nexport const three = 3;\n",
	);
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await page.getByTestId("diff-pane").getByText("two = 2").last().click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Shift+End");
	await addIcon(page).click();
	await page.getByTestId("review-composer-input").fill("Please rename `two` to `pair`.");
	await page.getByTestId("review-composer-send").click();

	const summary = page.getByTestId("review-package-summary");
	await expect(summary).toContainText("Sent 1 review comment on script.ts", { timeout: 30_000 });
	const item = page.getByTestId("review-package-item");
	await expect(item).toContainText("Please rename `two` to `pair`.");
	await expect(item).toContainText("L2");

	const unfoldAndAssert = async () => {
		await expect(item.locator("pre")).toHaveCount(0);
		await expect(async () => {
			await page.getByTestId("review-package-item-toggle").click();
			await expect(item).toHaveAttribute("data-expanded", "true", { timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		await expect(item.locator("pre")).toContainText("const two = 2;");
	};
	await unfoldAndAssert();

	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 90_000 });

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(0);
	await page.getByTestId("chat-history").first().click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(chatTabs).toHaveCount(1);
	await expect(page.getByTestId("review-package-summary")).toContainText(
		"Sent 1 review comment on script.ts",
	);
	await expect(item).toContainText("Please rename `two` to `pair`.");
	await expect(item.locator("pre")).toContainText("const two = 2;");
});
