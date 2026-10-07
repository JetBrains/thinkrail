import { realpathSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { AskUserQuestionArgs } from "@thinkrail/contracts";
import { defaultWorkspaceRow, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_704_000_000_000;
const askArgs: AskUserQuestionArgs = {
	questions: [
		{
			question: "Which?",
			header: "Pick",
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		},
	],
};

test("arrows move the highlight, and Enter/click/Esc/Mod+K all resolve to the right row", async ({
	page,
}) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	await openFixtureProject(page);
	const seeded = [
		seedWorkspaceSession(repo, {
			name: "Needs input chat",
			messages: [
				{ role: "user", text: "ask", timestamp: BASE_TS },
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "q", name: "ask_user_question", arguments: askArgs }],
					stopReason: "toolUse",
					timestamp: BASE_TS + 1,
				},
			],
		}),
		seedWorkspaceSession(repo, {
			name: "Unread result chat",
			messages: [
				{ role: "user", text: "do", timestamp: BASE_TS + 10 },
				{ role: "assistant", text: "done", timestamp: BASE_TS + 11 },
			],
		}),
	];
	try {
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-attention", "true");

		// Open, first row selected by cmdk.
		await page.keyboard.press("ControlOrMeta+k");
		const rows = page.getByTestId("session-switcher-row");
		await expect(rows.first()).toBeVisible();
		await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");

		// cmdk owns ArrowDown (root focused): selection moves to the second row.
		await page.keyboard.press("ArrowDown");
		await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
		await expect(rows.nth(0)).toHaveAttribute("aria-selected", "false");

		// Enter navigates and closes the palette.
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("session-switcher")).toBeHidden();
		await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");

		// Reopen and click a row → closes.
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.getByTestId("session-switcher")).toBeVisible();
		await page.getByTestId("session-switcher-row").first().click();
		await expect(page.getByTestId("session-switcher")).toBeHidden();

		// Reopen and Esc → closes (Radix owns Escape).
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.getByTestId("session-switcher")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("session-switcher")).toBeHidden();

		// Reopen and Mod+K again → closes (global chord suppressed; palette self-closes).
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.getByTestId("session-switcher")).toBeVisible();
		await page.keyboard.press("ControlOrMeta+k");
		await expect(page.getByTestId("session-switcher")).toBeHidden();
	} finally {
		for (const s of seeded) rmSync(s.path, { force: true });
	}
});
