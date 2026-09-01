import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	revealFirstProjectWorkspaces,
	worktreeRows,
} from "./fixtures/app";

test("a second tab reopens the same workspace chat and then sees live updates", {
	tag: "@agent",
}, async ({ page, context }) => {
	test.setTimeout(120_000);
	const message = (p: typeof page, role: "user" | "assistant", text: string) =>
		p.locator(`[data-testid="chat-message"][data-role="${role}"]`).filter({ hasText: text });

	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: alpha");
	await page.getByTestId("chat-send").click();
	await expect(message(page, "user", "alpha")).toBeVisible();
	await expect(message(page, "assistant", "alpha")).toBeVisible({ timeout: 80_000 });
	await expect(page.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false", {
		timeout: 80_000,
	});

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await worktreeRows(page2).first().getByRole("button").first().click();
	await expect(page2.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page2.getByTestId("chat-history")).toHaveCount(0);
	await expect(message(page2, "user", "alpha")).toBeVisible({ timeout: 30_000 });
	await expect(message(page2, "assistant", "alpha")).toBeVisible({ timeout: 30_000 });

	await page.getByTestId("chat-input").fill("Now reply with the single word: bravo");
	await page.getByTestId("chat-send").click();
	await expect(message(page2, "user", "bravo")).toBeVisible({ timeout: 30_000 });
	await expect(message(page2, "assistant", "bravo")).toBeVisible({ timeout: 80_000 });
	await expect(page2.getByTestId("chat-scroll")).toHaveAttribute("data-streaming", "false", {
		timeout: 80_000,
	});
});
