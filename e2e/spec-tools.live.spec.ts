import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expandActivityStep, openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

test("spec_grep is invoked against the workspace specs and rendered", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the spec_grep tool to search the project's specs for the text SPECGRAPHPROBE, then report which file it is in. Use only that tool.",
	);
	await waitForAgentSettled(page, 120_000);
	const step = await expandActivityStep(page, "spec_grep");
	await expect(step).toHaveAttribute("data-status", "done");
	await expect(step).toContainText("SPEC.md");
});

test("spec_search ranks the workspace's spec sections and is rendered with links", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"Use the spec_search tool to find the spec section about the throwaway fixture project, then report its file and heading. Use only that tool.",
	);
	await waitForAgentSettled(page, 120_000);
	const step = await expandActivityStep(page, "spec_search");
	await expect(step).toHaveAttribute("data-status", "done");
	await expect(step).toContainText("SPEC.md:7");
	await expect(step).toContainText("Sample Project › Goal");
});
