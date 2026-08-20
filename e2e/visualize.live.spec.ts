import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

async function awaitExpandedCard(page: Page, tool: string): Promise<Locator> {
	const card = page.locator(`[data-testid="tool-card"][data-tool="${tool}"]`).first();
	await expect(card).toBeVisible({ timeout: 90_000 });
	await expect(card).toHaveAttribute("data-expanded", "true", { timeout: 90_000 });
	return card;
}

test("visualize (diagram) renders mermaid as an SVG", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the visualize tool with type='diagram' and this exact mermaid source: `flowchart TD; User --> Server --> Database`. Use only that tool.",
	);
	const card = await awaitExpandedCard(page, "visualize");
	await expect(card.getByTestId("tool-visualize")).toBeVisible();
	await expect(card.getByTestId("tool-visualize-diagram")).toBeVisible();
	await expect(card.getByTestId("mermaid-svg").locator("svg").first()).toBeVisible({
		timeout: 30_000,
	});

	await card.getByTestId("mermaid-fullscreen").first().click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	const fsSvg = dialog.locator("svg").first();
	await expect(fsSvg).toBeVisible();
	const viewport = dialog.getByTestId("mermaid-fullscreen-svg");

	const widthBefore = (await fsSvg.boundingBox())?.width ?? 0;
	for (let i = 0; i < 4; i++) await dialog.getByTestId("mermaid-zoom-in").click();
	await expect(dialog.getByTestId("mermaid-zoom-level")).not.toHaveText("100%");
	await expect
		.poll(async () => (await fsSvg.boundingBox())?.width ?? 0)
		.toBeGreaterThan(widthBefore * 1.5);

	await expect
		.poll(() => viewport.evaluate((el) => el.scrollWidth - el.clientWidth))
		.toBeGreaterThan(0);
	const box = await viewport.boundingBox();
	if (!box) throw new Error("no fullscreen viewport box");
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	await page.mouse.move(cx - 140, cy - 90, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("visualize (comparison) renders option cards with a recommended pick", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the visualize tool with type='comparison' to compare REST and GraphQL — give each two pros and one con, and mark exactly one option as recommended. Use only that tool.",
	);
	const card = await awaitExpandedCard(page, "visualize");
	const body = card.getByTestId("tool-visualize-comparison");
	await expect(body).toBeVisible();
	await expect(body).toContainText("REST");
	await expect(body).toContainText("GraphQL");
	await expect(body.locator('[data-recommended="true"]').first()).toBeVisible();
});
