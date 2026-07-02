import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to prove the bundled `pi-spec-graph`
// extension is wired into every thinkrail session end to end. The agent can only call `spec_grep` if the
// extension loaded and registered it — so a `done` spec_grep card whose result names the seeded spec file
// proves the whole path: extension loaded → tool available → core parsed the worktree's specs → match
// returned. The fixture repo is seeded (global-setup) with a root `SPEC.md` (id `sample-root`) carrying the
// distinctive token `SPECGRAPHPROBE`; the matched file *path* is NOT in the query, so it proves a real hit,
// not an echo (cf. the web_search "Paris" assertion in web-tools.live.spec.ts).

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

test("spec_grep is invoked against the workspace specs and rendered", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the spec_grep tool to search the project's specs for the text SPECGRAPHPROBE, then report which file it is in. Use only that tool.",
	);
	// A `spec_grep` card at all proves the bundled pi-spec-graph extension registered the tool in this live
	// session. `data-status="done"` proves it executed without error, and the seeded file path in the body
	// (which is not part of the query) proves it searched the worktree's real specs and matched.
	const card = await expandToolCard(page, "spec_grep");
	await expect(card).toHaveAttribute("data-status", "done", { timeout: 120_000 });
	await expect(card).toContainText("SPEC.md", { timeout: 120_000 });
});
