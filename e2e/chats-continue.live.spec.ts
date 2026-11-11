import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { loadPersistedWorkspaces, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

function storedChats(): { chats: Workspace[] } {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "chats.json"), "utf8"));
}

test("Continue in workspace: the chat's agent writes the summary, the tool creates the workspace chat with the handoff, and the link survives", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	await openFixtureProject(page);
	await expect(worktreeRows(page)).toHaveCount(0);
	await page.getByTestId("add-chat").click();
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");

	await page
		.getByTestId("chat-input")
		.fill(
			"Plan how to add a one-line project description to the top of README.md. Just outline the steps in two sentences; do not edit anything.",
		);
	await page.getByTestId("chat-send").click();
	const done = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });
	await expect(done).toBeVisible({ timeout: 90_000 });

	const row = page.getByTestId("chat-item");
	await row.getByTestId("chat-menu").click();
	await page.getByTestId("chat-continue").click();
	const dialog = page.getByTestId("continue-chat-dialog");
	await dialog.getByTestId("continue-chat-confirm").click();
	await expect(dialog).toBeHidden();

	const card = page.getByTestId("continuation-card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	await expect(card).toHaveAttribute("data-phase", /summarizing|creating/);

	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "workspace", {
		timeout: 150_000,
	});
	await expect(worktreeRows(page)).toHaveCount(1);
	const handoff = page.getByTestId("handoff-card");
	await expect(handoff).toBeVisible({ timeout: 30_000 });
	await expect(handoff).toContainText("Continued from");
	await expect(handoff.getByTestId("handoff-summary")).not.toBeEmpty();

	const [chat] = storedChats().chats;
	const created = loadPersistedWorkspaces().find((candidate) => candidate.kind !== "default");
	expect(chat?.continuedTo?.[0]?.workspaceId).toBe(created?.id);
	await expect(page.getByTestId("chat-continued")).toContainText("Continued in sample-project");

	await handoff.getByTestId("handoff-open-source").click();
	await expect(page.getByTestId("scope-context")).toHaveAttribute("data-context", "chat");
	await expect(card).toHaveAttribute("data-phase", "started", { timeout: 30_000 });
	await expect(card.getByTestId("continuation-status")).toContainText(
		"Continued in a new workspace",
	);
	await expect(card.getByTestId("continuation-open")).toBeVisible();
});
