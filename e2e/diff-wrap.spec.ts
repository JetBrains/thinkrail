import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { commitFile } from "./fixtures/git";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { pierreLineLayout, pierreLines, selectPierreLine } from "./fixtures/pierre";

const LONG_LINE = `export const payload = "${"abcdefghij".repeat(60)}";`;

async function expectWrapped(surface: Locator) {
	await expect
		.poll(async () => {
			const layout = await pierreLineLayout(surface, LONG_LINE);
			return layout.height > layout.lineHeight * 2 && layout.scrollWidth <= layout.width + 1;
		})
		.toBe(true);
}

for (const lineCount of [3, 1_500]) {
	test(`source diff wrapping reflows ${lineCount} lines in both layouts and preserves review anchors and reloads`, async ({
		page,
	}) => {
		await openFixtureProject(page);
		await createWorkspaceViaDialog(page);
		const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
		const before = Array.from(
			{ length: lineCount },
			(_, index) => `export const v${index} = ${index};`,
		);
		commitFile(worktree, "wrap.ts", `${before.join("\n")}\n`, "seed long-line diff");
		const after = [...before];
		after[1] = LONG_LINE;
		writeFileSync(join(worktree, "wrap.ts"), `${after.join("\n")}\n`);
		await revealWorkbenchTool(page, "changes");
		await page.getByTestId("change-item").filter({ hasText: "wrap.ts" }).dblclick();

		const surface = page.getByTestId("diff-view");
		const toggle = page.getByTestId("diff-toggle-wrap");
		await expect(pierreLines(surface, LONG_LINE).last()).toBeVisible();
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		const unwrapped = await pierreLineLayout(surface, LONG_LINE);
		expect(unwrapped.height).toBeLessThanOrEqual(unwrapped.lineHeight * 1.2);
		if (lineCount === 3) await page.screenshot({ path: test.info().outputPath("diff-scroll.png") });

		const scrollOwner = await surface.elementHandle();
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expectWrapped(surface);
		expect(await scrollOwner?.evaluate((node) => node.isConnected)).toBe(true);
		if (lineCount === 3) await page.screenshot({ path: test.info().outputPath("diff-wrap.png") });
		await page.getByTestId("diff-toggle-inline").click();
		await expectWrapped(surface);
		await selectPierreLine(surface, LONG_LINE);
		await expect(page.getByTestId("review-composer")).toContainText("Line 2");
		await page.getByTestId("review-composer-input").fill("Review the original source line.");
		await page.getByTestId("review-composer-save").click();
		await expect(surface.getByTestId("review-thread-card")).toContainText(
			"Review the original source line.",
		);
		await page.getByTestId("diff-toggle-split").click();
		await expectWrapped(surface);

		await page.reload();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expectWrapped(surface);
		await expect(surface.getByTestId("review-thread-card")).toContainText(
			"Review the original source line.",
		);
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await expect
			.poll(async () => {
				const layout = await pierreLineLayout(surface, LONG_LINE);
				return layout.height <= layout.lineHeight * 1.2;
			})
			.toBe(true);
	});
}
