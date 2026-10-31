import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { commitFile } from "./fixtures/git";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { pierreCodeColumns } from "./fixtures/pierre";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("the viewport bottom scrollbar drags both diff panes and follows code scrolling", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	const source = (value: string) =>
		Array.from({ length: 150 }, (_, i) => `export const line${i} = "${value.repeat(20)}";`).join(
			"\n",
		);
	commitFile(worktree, "script.ts", source("before"), "Seed wide diff");
	writeFileSync(join(worktree, "script.ts"), source("after".repeat(3)));
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).dblclick();
	await page.getByTestId("diff-toggle-split").click();
	const diff = page.getByTestId("diff-view");
	await expect(pierreCodeColumns(diff).first()).toBeAttached({ timeout: 15_000 });
	const bar = diff.getByTestId("diff-horizontal-scrollbar");
	await expect(bar).toBeVisible();
	const columns = pierreCodeColumns(diff);
	await expect(columns).toHaveCount(2);
	await diff.evaluate((node) => {
		node.scrollTop = 700;
	});
	await expect.poll(() => diff.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
	const box = await bar.boundingBox();
	const viewport = await diff.boundingBox();
	if (!box || !viewport) throw new Error("Missing diff viewport");
	expect(Math.abs(box.y + box.height - viewport.y - viewport.height)).toBeLessThanOrEqual(7);
	for (const contrast of ["normal", "high"]) {
		await page.evaluate((value) => {
			document.documentElement.dataset.themeContrast = value;
		}, contrast);
		const appearance = () =>
			bar.evaluate((node) => {
				const owner = node.closest(".pierre-scroll-owner");
				if (!owner) throw new Error("Missing scrollbar owner");
				const read = (element: Element) => {
					const style = getComputedStyle(element);
					return [
						style.getPropertyValue("--scrollbar-thumb"),
						style.getPropertyValue("--scrollbar-thumb-inset"),
					];
				};
				return { horizontal: read(node), vertical: read(owner) };
			});
		for (const state of ["idle", "diff-hover", "thumb-hover", "leave", "intent", "intent-end"]) {
			await diff.evaluate((node, active) => {
				node.toggleAttribute("data-quiet-scroll-intent", active);
			}, state === "intent");
			if (state === "diff-hover") await page.mouse.move(viewport.x + 30, viewport.y + 30);
			else if (state === "thumb-hover") await page.mouse.move(box.x + 5, box.y + box.height - 3);
			else await page.mouse.move(0, 0);
			await expect
				.poll(
					async () => {
						const styles = await appearance();
						return styles.horizontal;
					},
					{ message: `${contrast}-${state}` },
				)
				.toEqual((await appearance()).vertical);
			await test.info().attach(`${contrast}-${state}`, {
				body: await diff.screenshot(),
				contentType: "image/png",
			});
		}
	}
	await page.evaluate(() => {
		delete document.documentElement.dataset.themeContrast;
	});
	const thumb = await bar.evaluate(
		(node) => (node.clientWidth * node.clientWidth) / node.scrollWidth,
	);
	await page.mouse.move(box.x + thumb / 2, box.y + box.height - 3);
	await page.mouse.down();
	await page.mouse.move(box.x + thumb / 2 + 100, box.y + box.height - 3, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => bar.evaluate((node) => node.scrollLeft)).toBeGreaterThan(50);
	await expect
		.poll(async () => {
			const left = await bar.evaluate((node) => node.scrollLeft);
			return columns.evaluateAll(
				(nodes, expected) =>
					nodes.every(
						(node) =>
							Math.abs(node.scrollLeft - Math.min(expected, node.scrollWidth - node.clientWidth)) <=
							1,
					),
				left,
			);
		})
		.toBe(true);
	// Drag all the way past the shorter column's range; delayed clamp echoes must not rewind it.
	await page.mouse.move(box.x + thumb / 2 + 100, box.y + box.height - 3);
	await page.mouse.down();
	const samples: number[] = [];
	for (let step = 1; step <= 24; step += 1) {
		await page.mouse.move(
			box.x + thumb / 2 + 100 + ((box.width - thumb / 2 - 102) * step) / 24,
			box.y + box.height - 3,
		);
		await page.waitForTimeout(35);
		const offset = await bar.evaluate((node) => node.scrollLeft);
		samples.push(offset);
		expect(
			await columns.evaluateAll(
				(nodes, left) =>
					nodes.every(
						(node) =>
							Math.abs(node.scrollLeft - Math.min(left, node.scrollWidth - node.clientWidth)) <= 1,
					),
				offset,
			),
		).toBe(true);
	}

	expect(samples.every((offset, index) => index === 0 || offset >= (samples[index - 1] ?? 0))).toBe(
		true,
	);
	const endX = box.x + box.width - 2;
	let previous = samples.at(-1) ?? 0;
	for (const delta of [-0.6, -0.8, -0.4, -0.7, 0]) {
		await page.mouse.move(endX + delta * box.width, box.y + box.height - 3);
		await expect
			.poll(async () => {
				const left = await bar.evaluate((node) => node.scrollLeft);
				return delta === 0 ? left > previous : left !== previous;
			})
			.toBe(true);
		const left = await bar.evaluate((node) => node.scrollLeft);
		expect(
			await columns.evaluateAll(
				(nodes, value) =>
					nodes.every(
						(node) =>
							Math.abs(node.scrollLeft - Math.min(value, node.scrollWidth - node.clientWidth)) <= 1,
					),
				left,
			),
		).toBe(true);
		previous = left;
	}
	await page.mouse.up();
	await expect
		.poll(() =>
			columns.evaluateAll((nodes) => (nodes[1]?.scrollLeft ?? 0) - (nodes[0]?.scrollLeft ?? 0)),
		)
		.toBeGreaterThan(100);
	await page.waitForTimeout(150);
	await expect
		.poll(() => bar.evaluate((node) => node.scrollWidth - node.clientWidth - node.scrollLeft))
		.toBeLessThanOrEqual(1);
	await diff.evaluate((node) => {
		node.scrollTop = node.scrollHeight;
	});
	await expect
		.poll(() =>
			bar.evaluate((node) => {
				const content = node.previousElementSibling;
				if (!content) throw new Error("Missing code content");
				return content.getBoundingClientRect().bottom - node.getBoundingClientRect().top;
			}),
		)
		.toBeLessThanOrEqual(1);
	await columns.last().evaluate((node) => {
		node.scrollLeft = 40;
	});
	await expect.poll(() => bar.evaluate((node) => node.scrollLeft)).toBe(40);
	await page.getByTestId("diff-toggle-inline").click();
	await expect(columns).toHaveCount(1);
	await expect(bar).toBeVisible();
	await columns.first().evaluate((node) => {
		node.scrollLeft = 80;
	});
	await expect.poll(() => bar.evaluate((node) => node.scrollLeft)).toBe(80);
	await page.getByTestId("diff-toggle-split").click();
	writeFileSync(join(worktree, "notes.txt"), "short changed line\n");
	await page.getByTestId("change-item").filter({ hasText: "notes.txt" }).dblclick();
	await expect(diff).toContainText("short changed line");
	await expect(bar).toBeHidden();
});

test("stacked review repositions the scrollbar when the preceding file expands", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "aaa-short.ts"), 'export const short = "changed";\n');
	writeFileSync(
		join(worktree, "bbb-tall.ts"),
		Array.from(
			{ length: 150 },
			(_, i) => `export const row${i} = "${"long".repeat(100)}";`,
		).join("\n"),
	);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "aaa-short.ts" }).click();
	const first = page.locator('[data-testid="changes-section"][data-path="aaa-short.ts"]');
	const diff = page
		.locator('[data-testid="changes-section"][data-path="bbb-tall.ts"]')
		.getByTestId("diff-view");
	await expect(pierreCodeColumns(diff).first()).toBeAttached({ timeout: 15_000 });
	const bar = diff.getByTestId("diff-horizontal-scrollbar");
	await expect(bar).toBeVisible();
	const geometry = () =>
		bar.evaluate((node) => {
			let parent = node.parentElement;
			while (
				parent &&
				!(
					parent.scrollHeight > parent.clientHeight + 1 &&
					/auto|scroll/.test(getComputedStyle(parent).overflowY)
				)
			)
				parent = parent.parentElement;
			if (!parent) throw new Error("Missing surrounding scroller");
			return {
				bottomGap: node.getBoundingClientRect().bottom - parent.getBoundingClientRect().bottom,
				diffTop: node.closest('[data-testid="diff-view"]')?.getBoundingClientRect().top ?? 0,
				scrollTop: parent.scrollTop,
			};
		});
	await expect.poll(async () => Math.abs((await geometry()).bottomGap)).toBeLessThanOrEqual(7);
	const before = await geometry();
	await first.getByTestId("hunk-ask-agent").click();
	await expect(first.getByTestId("review-composer-input")).toBeVisible();
	await expect.poll(async () => (await geometry()).diffTop).toBeGreaterThan(before.diffTop + 50);
	await expect.poll(async () => Math.abs((await geometry()).bottomGap)).toBeLessThanOrEqual(7);
	expect((await geometry()).scrollTop).toBe(before.scrollTop);
	const box = await bar.boundingBox();
	if (!box) throw new Error("Missing scrollbar bounds");
	const thumb = await bar.evaluate((node) => node.clientWidth ** 2 / node.scrollWidth);
	await page.mouse.move(box.x + thumb / 2, box.y + box.height - 3);
	await page.mouse.down();
	await page.mouse.move(box.x + thumb / 2 + 80, box.y + box.height - 3, { steps: 8 });
	await page.mouse.up();
	await expect.poll(() => bar.evaluate((node) => node.scrollLeft)).toBeGreaterThan(50);
});

test("stacked review keeps a tall file's scrollbar at the visible block edge", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	const source = (word: string) =>
		Array.from({ length: 150 }, (_, i) => `export const row${i} = "${word.repeat(80)}";`).join(
			"\n",
		);
	commitFile(worktree, "script.ts", source("before"), "Seed stacked wide file");
	writeFileSync(join(worktree, "script.ts"), source("after"));
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	const diff = page.getByTestId("changes-review").getByTestId("diff-view").first();
	await expect(pierreCodeColumns(diff).first()).toBeAttached({ timeout: 15_000 });
	const bar = diff.getByTestId("diff-horizontal-scrollbar");
	await expect
		.poll(() =>
			bar.evaluate((node) => {
				let parent = node.parentElement;
				while (
					parent &&
					!(
						parent.scrollHeight > parent.clientHeight + 1 &&
						/auto|scroll/.test(getComputedStyle(parent).overflowY)
					)
				)
					parent = parent.parentElement;
				if (!parent) throw new Error("Missing surrounding scroller");
				return Math.abs(
					node.getBoundingClientRect().bottom - parent.getBoundingClientRect().bottom,
				);
			}),
		)
		.toBeLessThanOrEqual(7);
	const footer = page.getByTestId("changes-review-triage");
	const box = await bar.boundingBox();
	const footerBox = await footer.boundingBox();
	if (!box || !footerBox) throw new Error("Missing stacked controls");
	expect(box.y + box.height).toBeLessThanOrEqual(footerBox.y + 1);
	const thumb = await bar.evaluate((node) => node.clientWidth ** 2 / node.scrollWidth);
	const x = box.x + thumb / 2;
	const y = box.y + box.height - 3;
	expect(
		await bar.evaluate((node, point) => document.elementFromPoint(point.x, point.y) === node, {
			x,
			y,
		}),
	).toBe(true);
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 80, y, { steps: 8 });
	await page.mouse.up();
	await expect.poll(() => bar.evaluate((node) => node.scrollLeft)).toBeGreaterThan(50);
});
