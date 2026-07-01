import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to exercise the bundled `pi-web-access`
// extension end to end, rendered by our own cards (joined by tool name). Proves the whole path: the agent
// calls the bundled tool → our WebSearchCard / WebFetchCard render it (the `tool-<name>` body is the proof
// the renderer registry matched; the generic fallback carries no such hook). Cards are collapsed by
// default, so expand before asserting.

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

async function expandToolCard(page: Page, tool: string): Promise<Locator> {
	const card = page.locator(`[data-testid="tool-card"][data-tool="${tool}"]`).first();
	await expect(card).toBeVisible({ timeout: 90_000 });
	if ((await card.getAttribute("data-expanded")) !== "true") {
		await card.getByTestId("tool-card-toggle").click();
		await expect(card).toHaveAttribute("data-expanded", "true");
	}
	return card;
}

test("fetch_content is invoked and rendered by our card", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Use the fetch_content tool to fetch https://example.com — use only that tool — then report the page title.",
	);
	// The `tool-fetch_content` body proves the agent invoked the bundled tool and our WebFetchCard matched.
	// We assert render, not extracted content: pi-web-access owns extraction (and tests it upstream), and a
	// successful fetch isn't hermetic here (external hosts are sandbox-blocked; the app shell has no body text).
	const card = await expandToolCard(page, "fetch_content");
	await expect(card.getByTestId("tool-fetch_content")).toBeVisible();
});

test("web_search renders a card with a real answer", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the web_search tool to find the capital of France, then state it. Use only that tool.",
	);
	const card = await expandToolCard(page, "web_search");
	const body = card.getByTestId("tool-web_search");
	await expect(body).toBeVisible();
	// "Paris" is in the answer but NOT the query — so this proves a real search result was returned and
	// rendered, not just the query echoed. Provider-native search is a full LLM call → generous budget.
	await expect(body).toContainText("Paris", { timeout: 120_000 });
});
