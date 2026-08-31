import { expect, test } from "@playwright/test";
import { activeWorktreeRow, openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

test("picking the seeded template from the / menu sends the expanded text and gets a reply", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(90_000);
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");

	await input.fill("/rev");
	const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
	await expect(rows).toHaveCount(1);
	await rows.first().click();
	await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

	await page.keyboard.type("SPEC.md");
	await expect(input).toHaveValue(/^Review SPEC\.md for issues, focusing on src\/\.\s*$/);
	await input.press("Tab");
	await expect(page.getByTestId("slot-hint")).toContainText("slot 2/2");
	await page.keyboard.type("the repository");

	await page.getByTestId("chat-send").click();

	const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(bubble).toContainText("SPEC.md");
	await expect(bubble).toContainText("the repository");
	await expect(bubble).not.toContainText("⟨");
	await expect(bubble).not.toContainText("/review");

	await waitForAgentSettled(page);
});

test("a typed-through /name command is expanded by pi itself, not the composer's slot parser", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	const workspace = await openWorkspaceChat(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const sessionId = await chatTab.getAttribute("data-session-id");
	if (!sessionId) throw new Error("Template test chat is missing its session id");
	const input = page.getByTestId("chat-input");

	await input.click();
	await page.keyboard.type("/review SPEC.md repository ");
	await expect(page.getByTestId("slash-menu")).toHaveCount(0);
	await page.keyboard.press("Enter");

	const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(bubble).toHaveText("/review SPEC.md repository");

	await waitForAgentSettled(page);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeWorktreeRow(page)).toHaveCount(1);

	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const wire = await E2eWire.connect();
	const transcript = await wire
		.request("session.getMessages", { sessionId, workspaceId: workspace.id })
		.finally(() => wire.close());
	const restoredUser = transcript.messages.find((message) => message.role === "user");
	if (restoredUser?.role !== "user") {
		throw new Error("Template test transcript is missing its user message");
	}
	expect(restoredUser.content).toEqual([
		{ type: "text", text: "Review SPEC.md for issues, focusing on repository." },
	]);
});
