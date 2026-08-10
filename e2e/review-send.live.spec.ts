import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

// Tagged @agent (see agent.live.spec.ts): a review send drives a real pi session. Proves the chat-side
// contract of a send — the package lands as a FOLDABLE user card whose unfold shows what was actually
// sent (per file → the comment text + the quoted fragment), and it still unfolds after the chat is
// closed and reopened from disk: everything renders from the transcript message itself, so the history
// keeps answering "what happened" long after the review is gone.

const worktree = () => join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
const addIcon = (page: Page) => page.locator('[data-testid="review-add-icon"]:visible');

test("a review send reads back from the chat: summary → file → comment + fragment, disk reopen included", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// A draft on script.ts line 2, then Send now — the package fires into a fresh review chat.
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

	// The chat opens on the package's card: the summary line with the COMMENT rows right under it (a
	// send is one message per file — no file level), fragments folded away.
	const summary = page.getByTestId("review-package-summary");
	await expect(summary).toContainText("Sent 1 review comment on script.ts", { timeout: 30_000 });
	const item = page.getByTestId("review-package-item");
	await expect(item).toContainText("Please rename `two` to `pair`.");
	await expect(item).toContainText("L2");

	// Unfold the comment row → full text + the quoted fragment, parsed from the message itself. The
	// toggle retries as one block: right after a reopen the row can remount mid-click (hydration mints
	// fresh row ids), swallowing the first click.
	const unfoldAndAssert = async () => {
		// The fragment shows only once the comment row unfolds.
		await expect(item.locator("pre")).toHaveCount(0);
		await expect(async () => {
			await page.getByTestId("review-package-item-toggle").click();
			await expect(item).toHaveAttribute("data-expanded", "true", { timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		await expect(item.locator("pre")).toContainText("const two = 2;");
	};
	await unfoldAndAssert();

	// Let the turn finish before closing (a streaming session keeps the tab busy).
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 90_000 });

	// Close the chat and reopen it from history: the card re-renders from the transcript message (the
	// single durable source) and the folds SURVIVE — the shared fold cache is keyed by the row ids the
	// still-live runtime kept, so what the user had unfolded stays unfolded.
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(0);
	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(chatTabs).toHaveCount(1);
	await expect(page.getByTestId("review-package-summary")).toContainText(
		"Sent 1 review comment on script.ts",
	);
	await expect(item).toContainText("Please rename `two` to `pair`.");
	await expect(item.locator("pre")).toContainText("const two = 2;");
});
