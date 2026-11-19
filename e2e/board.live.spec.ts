import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, worktreeRows } from "./fixtures/app";

declare global {
	interface Window {
		boardLastActions?: string[];
	}
}

const TITLE = "Add a one-line comment-free usage example to README.md";

test("a small card started from the board works with its last action shown, then settles into Review with its diff", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tool-rail-ext:board:board").click();
	const board = page.getByTestId("board-tool");
	await expect(board).toBeVisible();

	await board.getByTestId("board-new").click();
	await board.getByTestId("board-new-card-title").fill(TITLE);
	await board.getByTestId("board-new-card-title").press("Enter");
	const tile = board.getByTestId("board-card").filter({ hasText: TITLE });
	await expect(tile).toHaveAttribute("data-column", "backlog");
	const peek = page.getByTestId("peek-pane").getByTestId("board-card-panel");
	await peek.getByTestId("board-card-size").selectOption("S");
	await expect(tile.getByTestId("board-size")).toHaveText("S");
	await expect(peek.getByTestId("board-start-workflow")).toHaveValue("implement");

	await page.evaluate(() => {
		const seen: string[] = [];
		window.boardLastActions = seen;
		const record = () => {
			for (const node of document.querySelectorAll<HTMLElement>(
				'[data-testid="board-last-action"]',
			)) {
				const text = `${node.dataset.tool ?? ""}|${node.textContent ?? ""}`;
				if (!seen.includes(text)) seen.push(text);
			}
		};
		new MutationObserver(record).observe(document.body, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
		});
	});
	await peek.getByTestId("board-start-submit").click();
	await expect(peek.getByTestId("board-attempt")).toHaveCount(1, { timeout: 60_000 });
	await expect(worktreeRows(page)).toHaveCount(1);

	await expect(tile).toHaveAttribute("data-column", "review", { timeout: 240_000 });
	await expect(tile.getByTestId("board-diff")).toBeVisible();
	await expect(tile.getByTestId("board-agent-badge")).toHaveAttribute(
		"data-badge",
		/finished|unread/,
	);
	await expect(tile.getByTestId("board-last-action")).toHaveCount(0);
	const seen = (await page.evaluate(() => window.boardLastActions)) ?? [];
	expect(seen.length).toBeGreaterThan(0);
	expect(seen.some((entry) => /^(read|edit|write|bash)\|/.test(entry))).toBe(true);
	await expect(peek.getByTestId("board-card-column")).toHaveText("Review");
});
