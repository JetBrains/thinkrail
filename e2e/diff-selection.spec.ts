import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

// Regression for the diff text-selection crash (panels/SPEC.md "Pierre diff text-selection
// crash"): Pierre moved the gutter-utility node between line cells on every pointermove, so a
// native selection drag mutated the DOM under the live selection and crashed WebKit's
// web-content process. Fixed upstream in pierrecomputer/pierre#1185, carried here as
// patches/@pierre%2Fdiffs@1.5.1.patch until a Pierre release ships it.
//
// The hard crash reproduces only on WebKit, which this suite does not run; on Chromium we keep
// the gesture exercised and assert the controls that make a pass meaningful — the selection
// really grew and the diff really was a clipped scroller. Without them a broken layout (nothing
// selectable) reads as a false "no crash".

function largeCodeFile(edited: boolean): string {
	const lines: string[] = [];
	for (let index = 0; index < 1500; index += 1) {
		const suffix = edited && index % 7 === 0 ? ` /* edited ${index} */` : "";
		lines.push(`export const value_${index} = ${index} + alpha + beta + gamma;${suffix}`);
	}
	return `${lines.join("\n")}\n`;
}

async function openBigDiff(page: Page) {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "big.ts"), largeCodeFile(true));
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "big.ts" }).click();
	const diff = page.getByTestId("diff-view");
	await expect(diff).toBeVisible();
	await expect(diff.getByText("value_0 =", { exact: false }).first()).toBeVisible();
	return diff;
}

test("drag-selecting text across a long diff neither crashes nor loses the selection", async ({
	page,
}) => {
	let crashed = false;
	page.on("crash", () => {
		crashed = true;
	});

	const diff = await openBigDiff(page);
	const box = await diff.boundingBox();
	if (!box) throw new Error("diff-view has no bounding box");

	// Press on a code line, then drag down across lines and hold at the bottom edge so the
	// selection keeps extending (the gesture that crashed WebKit).
	await page.mouse.move(box.x + box.width / 2, box.y + 30);
	await page.mouse.down();
	for (let step = 1; step <= 8 && !page.isClosed(); step += 1) {
		await page.mouse.move(box.x + box.width / 2, box.y + 30 + ((box.height - 50) / 8) * step, {
			steps: 3,
		});
		await page.waitForTimeout(60);
	}
	for (let i = 0; i < 20 && !page.isClosed(); i += 1) {
		await page.mouse.move(box.x + box.width / 2 + (i % 2), box.y + box.height - 6, { steps: 1 });
		await page.waitForTimeout(50);
	}
	if (!page.isClosed()) await page.mouse.up();

	expect(crashed, "web-content process crashed").toBe(false);
	expect(page.isClosed(), "page was closed by a crash").toBe(false);

	const selectionLength = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
	const [scrollHeight, clientHeight] = await diff.evaluate((node) => [
		node.scrollHeight,
		node.clientHeight,
	]);
	expect(selectionLength, "the drag must actually select text").toBeGreaterThan(500);
	expect(scrollHeight, "the diff must actually be a clipped scroller").toBeGreaterThan(
		clientHeight,
	);
});
