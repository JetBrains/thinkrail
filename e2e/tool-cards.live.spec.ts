import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent. Proves the built-in tool renderers
// registered in chat/tools/register.ts render their specialized card bodies (not the generic JSON
// fallback) — the presence of a `data-testid="tool-<name>"` body is itself the proof the registry
// matched, since DefaultToolRenderer carries no such hook. pi's built-in tools execute without an
// approval prompt, so no extension-UI dialog is in the way.
//
// Tool cards are COLLAPSED by default (ToolCard) to keep routine calls from cluttering the chat, so
// each test waits for the card by its `data-tool`, then expands it via the header toggle before
// asserting on the (now-rendered) body.

/** Open a workspace chat and send `prompt`. */
async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

/** Wait for the collapsed tool card with the given `data-tool`, expand it, and return the card locator. */
async function expandToolCard(page: Page, tool: string): Promise<Locator> {
	const card = page.locator(`[data-testid="tool-card"][data-tool="${tool}"]`).first();
	await expect(card).toBeVisible({ timeout: 90_000 });
	if ((await card.getAttribute("data-expanded")) !== "true") {
		await card.getByTestId("tool-card-toggle").click();
		await expect(card).toHaveAttribute("data-expanded", "true");
	}
	return card;
}

test("bash tool renders as a terminal card", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Use the bash tool to run exactly this command: echo thinkrail-bash-marker — and nothing else.",
	);
	const card = await expandToolCard(page, "bash");
	// The command line + the captured stdout both surface inside the terminal body.
	const body = card.getByTestId("tool-bash");
	await expect(body).toBeVisible();
	await expect(body).toContainText("thinkrail-bash-marker");
});

test("read tool renders a file card naming the file", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Use the read tool to read the file README.md in the current directory. Do not summarize it.",
	);
	const card = await expandToolCard(page, "read");
	await expect(card.getByTestId("tool-read")).toContainText("README.md");
});

test("write then edit render a preview card and a diff card", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"First use the write tool to create a new file notes.txt whose only content is the line: hello world. " +
			"Then use the edit tool to replace 'hello world' with 'goodbye world' in notes.txt.",
	);
	const write = await expandToolCard(page, "write");
	await expect(write.getByTestId("tool-write")).toContainText("notes.txt");

	const edit = await expandToolCard(page, "edit");
	await expect(edit.getByTestId("tool-edit")).toContainText("notes.txt");
});

test("long written content collapses behind a Show all toggle (Task 10)", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Use the write tool to create a file count.txt containing the numbers 1 to 40, one number per line, and nothing else.",
	);
	const card = await expandToolCard(page, "write");

	// 40 lines is well over the collapse threshold → a "Show all N lines" toggle, collapsed by default.
	const toggle = card.getByTestId("collapsible-toggle").first();
	await expect(toggle).toBeVisible({ timeout: 30_000 });
	await expect(toggle).toContainText("Show all");
	const collapsible = card.getByTestId("collapsible").first();
	await expect(collapsible).toHaveAttribute("data-expanded", "false");

	// Expanding flips the label and the state.
	await toggle.click();
	await expect(collapsible).toHaveAttribute("data-expanded", "true");
	await expect(toggle).toContainText("Show less");
});
