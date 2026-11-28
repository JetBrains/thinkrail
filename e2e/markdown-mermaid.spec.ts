import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";

test("renders mermaid fences as diagrams in the rendered markdown view", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");

	const file = page.getByTestId("file-node").filter({ hasText: "DIAGRAM.md" });
	await expect(file).toBeVisible();
	await file.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	await expect(preview.getByTestId("mermaid-svg").locator("svg")).toBeVisible({ timeout: 20_000 });
	await expect(preview.getByTestId("mermaid-svg")).toHaveCount(1);
	const inlineViewport = preview.getByTestId("mermaid-svg");
	const naturalHeight = (await inlineViewport.locator("svg").boundingBox())?.height ?? 0;
	expect(naturalHeight).toBeGreaterThan(0);
	expect(naturalHeight).toBeLessThan(480);
	expect((await inlineViewport.boundingBox())?.height).toBeCloseTo(naturalHeight, 0);
	await preview.getByTestId("mermaid-zoom-in").focus();
	await preview.getByTestId("mermaid-zoom-in").press("Enter");
	await expect(preview.getByTestId("mermaid-zoom-level")).toHaveText("125%");
	await expect
		.poll(async () => (await inlineViewport.locator("svg").boundingBox())?.height ?? 0)
		.toBeGreaterThan(naturalHeight * 1.2);
	expect((await inlineViewport.boundingBox())?.height).toBeCloseTo(naturalHeight, 0);
	await preview.getByTestId("mermaid-zoom-reset").click();
	const error = preview.getByTestId("mermaid-error");
	await expect(error).toHaveCount(1);
	await expect(error).toContainText("broken");

	await expect(
		preview.locator("pre.highlights", { hasText: "plain-fence-stays-code" }),
	).toBeVisible();

	await preview.getByTestId("mermaid-fullscreen").click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	const gestureClaimed = await dialog.getByTestId("mermaid-fullscreen-svg").evaluate((element) => {
		const dispatch = (type: string, scale: number) => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, "scale", { value: scale });
			return element.dispatchEvent(event);
		};
		return [
			dispatch("gesturestart", 1),
			dispatch("gesturechange", 1.5),
			dispatch("gestureend", 1.5),
		];
	});
	await expect(dialog.getByTestId("mermaid-zoom-level")).toHaveText("150%");
	expect(gestureClaimed).toEqual([false, false, false]);
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(preview.getByTestId("mermaid-zoom-level")).toHaveText("100%");

	await page.getByTestId("view-toggle-code").click();
	await expect(page.getByTestId("editor-pane")).toContainText("flowchart TD; Start --> Finish");
});

test("a tall Markdown diagram stays bounded while zooming and panning, and wheel scrolls the prose", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const steps = Array.from(
		{ length: 30 },
		(_, i) => `N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`,
	).join("\n");
	writeFileSync(
		join(workspace.worktreePath, "TALL-DIAGRAM.md"),
		`# Long diagram\n\n\`\`\`mermaid\nflowchart TD\n${steps}\n\`\`\`\n\n` +
			Array.from({ length: 20 }, (_, i) => `Paragraph after the diagram ${i}.`).join("\n\n"),
	);
	await revealWorkbenchTool(page, "files");
	const file = page.getByTestId("file-node").filter({ hasText: "TALL-DIAGRAM.md" });
	await expect(file).toBeVisible();
	await file.dblclick();
	const preview = page.getByTestId("markdown-preview");
	const viewport = preview.getByTestId("mermaid-svg");
	await expect(viewport.locator("svg")).toBeVisible({ timeout: 20_000 });
	await expect.poll(async () => (await viewport.boundingBox())?.height ?? 0).toBeCloseTo(480, 0);
	expect((await viewport.locator("svg").boundingBox())?.height ?? 0).toBeGreaterThan(1000);
	await preview.getByTestId("mermaid-zoom-in").click();
	await preview.getByTestId("mermaid-zoom-in").click();
	await expect(preview.getByTestId("mermaid-zoom-level")).toHaveText("156%");
	expect((await viewport.boundingBox())?.height).toBeCloseTo(480, 0);
	await viewport.scrollIntoViewIfNeeded();
	const box = await viewport.boundingBox();
	if (!box) throw new Error("Missing inline diagram viewport");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 5 });
	await page.mouse.up();
	await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	const diagramScroll = await viewport.evaluate((element) => element.scrollTop);
	await viewport.hover();
	const before = await preview.evaluate((element) => element.scrollTop);
	await page.mouse.wheel(0, 300);
	await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
	expect(await viewport.evaluate((element) => element.scrollTop)).toBe(diagramScroll);
	await page.setViewportSize({ width: 1280, height: 600 });
	await expect.poll(async () => (await viewport.boundingBox())?.height ?? 0).toBeCloseTo(360, 0);
	await viewport.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	for (let i = 0; i < 10; i++) await preview.getByTestId("mermaid-zoom-out").click();
	await expect(preview.getByTestId("mermaid-zoom-level")).toHaveText("25%");
	expect((await viewport.boundingBox())?.height).toBeCloseTo(360, 0);
	await expect
		.poll(() =>
			viewport.evaluate((element) => {
				const drawing = element.querySelector("svg");
				if (!drawing) throw new Error("Missing diagram");
				return (
					element.scrollTop -
					Math.max(0, drawing.getBoundingClientRect().height - element.clientHeight)
				);
			}),
		)
		.toBeLessThanOrEqual(1);
});
