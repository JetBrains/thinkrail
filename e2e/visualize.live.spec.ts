import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to exercise the bundled `pi-visualize`
// extension end to end, rendered by our own cards (joined by tool name). Proves the whole path: the agent
// calls `visualize` → VisualizationCard matches (the `tool-visualize` body is the proof the registry
// matched; the generic fallback carries no such hook) → it dispatches on `type` to the diagram /
// comparison card. `visualize` is registered PRIMARY + defaultExpanded: it escapes the activity fold
// (its own `tool-card`, never an activity step) and auto-expands once the call completes — asserted
// here rather than clicking the toggle, pinning the progressive-disclosure contract.

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

/** Wait for the primary `visualize` card and its auto-expand on completion (defaultExpanded). */
async function awaitExpandedCard(page: Page, tool: string): Promise<Locator> {
	const card = page.locator(`[data-testid="tool-card"][data-tool="${tool}"]`).first();
	await expect(card).toBeVisible({ timeout: 90_000 });
	await expect(card).toHaveAttribute("data-expanded", "true", { timeout: 90_000 });
	return card;
}

test("visualize (diagram) renders mermaid as an SVG", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(150_000);
	// Give the exact mermaid so the test verifies the render pipeline (extension → card → SVG), not the
	// agent's diagram-authoring — a passthrough the agent reliably performs.
	await openChatAndSend(
		page,
		"Use the visualize tool with type='diagram' and this exact mermaid source: `flowchart TD; User --> Server --> Database`. Use only that tool.",
	);
	const card = await awaitExpandedCard(page, "visualize");
	await expect(card.getByTestId("tool-visualize")).toBeVisible();
	await expect(card.getByTestId("tool-visualize-diagram")).toBeVisible();
	// A real <svg> proves mermaid actually rendered (not just the source echoed / an error fallback).
	await expect(card.getByTestId("mermaid-svg").locator("svg").first()).toBeVisible({
		timeout: 30_000,
	});

	// Full screen: open the diagram in a dialog (with its own close button), verify it renders, dismiss.
	await card.getByTestId("mermaid-fullscreen").first().click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	const fsSvg = dialog.locator("svg").first();
	await expect(fsSvg).toBeVisible();
	const viewport = dialog.getByTestId("mermaid-fullscreen-svg");

	// Zooming in must actually enlarge the rendered diagram, not just move the % label.
	const widthBefore = (await fsSvg.boundingBox())?.width ?? 0;
	for (let i = 0; i < 4; i++) await dialog.getByTestId("mermaid-zoom-in").click();
	await expect(dialog.getByTestId("mermaid-zoom-level")).not.toHaveText("100%");
	await expect
		.poll(async () => (await fsSvg.boundingBox())?.width ?? 0)
		.toBeGreaterThan(widthBefore * 1.5);

	// Zoomed in, the viewport overflows and can be panned by dragging with the mouse.
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
	// The `recommended` flag drives a highlighted card — proves that field flows through end to end.
	await expect(body.locator('[data-recommended="true"]').first()).toBeVisible();
});
