import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";

const TITLE = "Add a one-line usage example to README.md";
const CRITERIA = [
	"README.md gains exactly one new line with a usage example",
	"No other file changes",
];

test("Smart review on a small finished card gives every criterion a verdict with the real reviewer", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(600_000);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tool-rail-ext:board:board").click();
	const board = page.getByTestId("board-tool");
	await expect(board).toBeVisible();

	await board.getByTestId("board-new").click();
	await board.getByTestId("board-new-card-title").fill(TITLE);
	await board.getByTestId("board-new-card-title").press("Enter");
	const tile = board.getByTestId("board-card").filter({ hasText: TITLE });
	const peek = page.getByTestId("peek-pane").getByTestId("board-card-panel");
	await peek.getByTestId("board-card-size").selectOption("S");
	for (const [index, criterion] of CRITERIA.entries()) {
		await peek.getByTestId("board-card-acceptance-add").fill(criterion);
		await peek.getByTestId("board-card-acceptance-add").press("Enter");
		await expect(peek.getByTestId("board-card-acceptance-item")).toHaveCount(index + 1);
	}
	await expect(peek.getByTestId("board-start-workflow")).toHaveValue("implement");
	await peek.getByTestId("board-start-submit").click();
	await expect(peek.getByTestId("board-attempt")).toHaveCount(1, { timeout: 60_000 });
	await expect(tile).toHaveAttribute("data-column", "review", { timeout: 300_000 });

	const section = peek.getByTestId("board-review-section");
	await section.getByTestId("board-review-run").click();
	await expect(section.getByTestId("board-review-running")).toBeVisible();
	const rows = section.getByTestId("board-review-item");
	await expect(rows).toHaveCount(CRITERIA.length, { timeout: 280_000 });
	await expect(section.getByTestId("board-review-error")).toHaveCount(0);
	for (const [index, criterion] of CRITERIA.entries()) {
		await expect(rows.nth(index)).toContainText(criterion);
		await expect(rows.nth(index)).toHaveAttribute("data-verdict", /^(met|unmet|untested)$/);
	}
	await expect(tile.getByTestId("board-conformance")).toHaveText(
		new RegExp(`^\\d/${CRITERIA.length} met$`),
	);
	await expect(section.getByTestId("board-packet")).toBeVisible();
});
