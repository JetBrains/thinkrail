import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { commitFile } from "./fixtures/git";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { pierreCodeColumns } from "./fixtures/pierre";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("small native thumb drags remain proportional near both diff edges", async ({ page }) => {
	test.setTimeout(90_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	const source = (word: string) =>
		Array.from({ length: 150 }, (_, i) => `export const row${i} = "${word.repeat(80)}";`).join(
			"\n",
		);
	commitFile(worktree, "script.ts", source("before"), "Seed edge drag");
	writeFileSync(join(worktree, "script.ts"), source("after"));
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).dblclick();
	await page.getByTestId("diff-toggle-split").click();
	const diff = page.getByTestId("diff-view");
	await expect(pierreCodeColumns(diff).first()).toBeAttached({ timeout: 15_000 });
	const bar = diff.getByTestId("diff-horizontal-scrollbar");
	await expect
		.poll(() =>
			pierreCodeColumns(diff)
				.first()
				.evaluate((node) => node.scrollWidth - node.clientWidth),
		)
		.toBeGreaterThan(100);
	await expect(bar).toBeVisible();
	await bar.evaluate((node) => {
		const control = node.cloneNode(true) as HTMLElement;
		control.dataset.testid = "native-edge-control";
		Object.assign(control.style, {
			position: "fixed",
			left: "20px",
			right: "auto",
			bottom: "20px",
			width: `${node.clientWidth}px`,
			zIndex: "9999",
		});
		document.body.append(control);
	});
	const native = page.getByTestId("native-edge-control");
	// Match browser pointer/thumb integer rounding, not a percentage of the scroll range.
	for (const target of [native, bar]) {
		const box = await target.boundingBox();
		if (!box) throw new Error("Missing scrollbar");
		const { width, range } = await target.evaluate((node) => ({
			width: node.clientWidth,
			range: node.scrollWidth - node.clientWidth,
		}));
		const thumb = (width * width) / (width + range);
		const travel = width - thumb;
		for (const start of [0.09, 0.91]) {
			await target.evaluate((node, left) => {
				node.scrollLeft = left;
			}, range * start);
			await page.waitForTimeout(100);
			const initial = await target.evaluate((node) => node.scrollLeft);
			const x = box.x + thumb / 2 + (travel * initial) / range;
			const y = box.y + box.height - 3;
			await page.mouse.move(x, y);
			await page.mouse.down();
			const edgeSteps = Math.floor(travel * 0.085);
			let previous = initial;
			for (let step = 1; step <= edgeSteps + 8; step++) {
				const distance = step <= edgeSteps ? step : edgeSteps - (step - edgeSteps);
				const delta = distance * (start < 0.5 ? -1 : 1);
				await page.mouse.move(x + delta, y);
				await page.waitForTimeout(50);
				const actual = await target.evaluate((node) => node.scrollLeft);
				const expected = initial + (delta * range) / travel;
				const direction = (start < 0.5 ? -1 : 1) * (step <= edgeSteps ? 1 : -1);
				expect((actual - previous) * direction).toBeGreaterThanOrEqual(-1);
				previous = actual;
				if (target === bar) {
					expect(
						await pierreCodeColumns(diff).evaluateAll(
							(nodes, left) =>
								nodes.every(
									(node) =>
										Math.abs(
											node.scrollLeft - Math.min(left, node.scrollWidth - node.clientWidth),
										) <= 1,
								),
							actual,
						),
					).toBe(true);
				}
				expect(
					Math.abs(actual - expected),
					JSON.stringify({
						control: target === native,
						start,
						step,
						initial,
						actual,
						expected,
						width,
						range,
						thumb,
					}),
				).toBeLessThanOrEqual((range / travel) * 2 + 1);
			}
			await page.mouse.up();
		}
	}
});
