import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expandActivityStep, openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";

async function openChatAndSend(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

async function expandToolStep(page: Page, tool: string): Promise<Locator> {
	await waitForAgentSettled(page);
	return expandActivityStep(page, tool);
}

test("bash tool renders as a terminal step body", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Use the bash tool to run exactly this command: echo thinkrail-bash-marker — and nothing else.",
	);
	const step = await expandToolStep(page, "bash");
	const body = step.getByTestId("tool-bash");
	await expect(body).toBeVisible();
	await expect(body).toContainText("thinkrail-bash-marker");
});

test("read tool renders a file step naming the file", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(120_000);
	await openChatAndSend(
		page,
		"Use the read tool to read the file README.md in the current directory. Do not summarize it.",
	);
	const step = await expandToolStep(page, "read");
	await expect(step.getByTestId("tool-read")).toContainText("README.md");
});

test("write then edit render a preview body and a diff body", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await openChatAndSend(
		page,
		"First use the write tool to create a new file notes.txt whose only content is the line: hello world. " +
			"Then use the edit tool to replace 'hello world' with 'goodbye world' in notes.txt.",
	);
	const write = await expandToolStep(page, "write");
	await expect(write.getByTestId("tool-write")).toContainText("notes.txt");

	const edit = await expandToolStep(page, "edit");
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
	const step = await expandToolStep(page, "write");

	const toggle = step.getByTestId("collapsible-toggle").first();
	await expect(toggle).toBeVisible({ timeout: 30_000 });
	await expect(toggle).toContainText("Show all");
	const collapsible = step.getByTestId("collapsible").first();
	await expect(collapsible).toHaveAttribute("data-expanded", "false");

	await toggle.click();
	await expect(collapsible).toHaveAttribute("data-expanded", "true");
	await expect(toggle).toContainText("Show less");
});
