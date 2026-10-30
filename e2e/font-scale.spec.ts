import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";

const fontSize = (locator: Locator) =>
	locator.evaluate((element) => getComputedStyle(element).fontSize);

async function scaleTo160(page: Page) {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await page.getByTestId("font-scale-input").focus();
	// One notch per key, the way a drag moves it: 100% → 160%.
	for (let step = 0; step < 12; step += 1) await page.keyboard.press("ArrowRight");
	await expect(page.getByTestId("font-scale-value")).toHaveText("160%");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

test("an open file editor and review follow the font size slider without a reload", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "script.ts"), "export const edited = true;\n");

	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	const code = page.locator('[data-testid="editor-pane"]:visible .view-lines');
	await expect(code).toContainText("plain-text-fixture");
	expect(await fontSize(code)).toBe("11px");

	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	const review = page.locator('[data-testid="changes-section"][data-path="script.ts"]');
	await expect(review.getByText("edited = true").last()).toBeVisible();

	await scaleTo160(page);

	await expect.poll(() => fontSize(review.getByText("edited = true").last())).toBe("18px");
	await page.getByTestId("editor-tab").filter({ hasText: "notes.txt" }).click();
	await expect.poll(() => fontSize(code)).toBe("18px");
});

test("the slider stays inside the settings pane while a drag grows the text above it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	const input = page.getByTestId("font-scale-input");
	await input.scrollIntoViewIfNeeded();
	const start = await input.boundingBox();
	if (!start) throw new Error("font scale slider has no box");

	const y = start.y + start.height / 2;
	await page.mouse.move(start.x + start.width * 0.25, y);
	await page.mouse.down();
	await page.mouse.move(start.x + start.width, y, { steps: 12 });
	await page.mouse.up();
	await expect(page.getByTestId("font-scale-value")).toHaveText("160%");

	const end = await input.boundingBox();
	const dialog = await page.getByTestId("settings-dialog").boundingBox();
	if (!end || !dialog) throw new Error("lost the slider or the dialog");
	expect(Math.abs(end.y - start.y)).toBeLessThan(4);
	expect(end.y + end.height).toBeLessThanOrEqual(dialog.y + dialog.height);
});

test("the top bar grows with the text so no caption or value is cut off at 160%", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const topbar = page.getByTestId("topbar");
	// A row may let the line box overflow (the caption sits at 15px leading in a 14px row, by
	// design), but every clipping box must stay tall enough for the glyphs and contain their centre.
	const clipped = () =>
		topbar.evaluate((bar) =>
			[...bar.querySelectorAll<HTMLElement>("span, button, div")]
				.filter((element) => element.childElementCount === 0 && element.textContent?.trim())
				.filter((element) => {
					const own = element.getBoundingClientRect();
					if (own.height === 0) return false;
					const glyphs = Number.parseFloat(getComputedStyle(element).fontSize);
					const centre = own.top + own.height / 2;
					for (let box: HTMLElement | null = element; box && box !== bar; box = box.parentElement) {
						if (getComputedStyle(box).overflow === "visible") continue;
						const frame = box.getBoundingClientRect();
						if (frame.height + 0.5 < glyphs) return true;
						if (centre < frame.top || centre > frame.bottom) return true;
					}
					return false;
				})
				.map((element) => element.textContent?.trim()),
		);
	expect(await clipped()).toEqual([]);
	const before = await topbar.evaluate((bar) => bar.getBoundingClientRect().height);

	await scaleTo160(page);

	await expect
		.poll(() => topbar.evaluate((bar) => bar.getBoundingClientRect().height))
		.toBe(Math.round(before * 1.6));
	expect(await clipped()).toEqual([]);
});
