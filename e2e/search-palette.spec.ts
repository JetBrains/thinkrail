import { realpathSync, rmSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { AskUserQuestionArgs } from "@thinkrail/pi-ask-user-question/core";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
} from "./fixtures/app";
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

function palette(page: Page) {
	return page.getByTestId("search-palette");
}

async function openPalette(page: Page): Promise<void> {
	await pressPlatformShortcut(page, "k");
	await expect(palette(page)).toBeVisible();
	await expect(page.getByTestId("search-input")).toBeFocused();
}

async function doubleShift(page: Page): Promise<void> {
	await page.keyboard.press("Shift");
	await page.keyboard.press("Shift");
}

function seedAttention(repo: string) {
	return [
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
}

test("the empty palette lists the chats waiting for you; arrows, Enter, click and Esc resolve them", async ({
	page,
}) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	await openFixtureProject(page);
	const seeded = seedAttention(repo);
	try {
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-attention", "true");

		await openPalette(page);
		const waiting = page.locator('[data-testid="search-section"][data-section="waiting"]');
		const rows = waiting.getByTestId("search-row");
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
		await expect(rows.nth(0)).toContainText("Needs input chat");

		await page.keyboard.press("ArrowDown");
		await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
		await expect(rows.nth(0)).toHaveAttribute("aria-selected", "false");

		await page.keyboard.press("Enter");
		await expect(palette(page)).toBeHidden();
		await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");

		await openPalette(page);
		await waiting.getByTestId("search-row").first().click();
		await expect(palette(page)).toBeHidden();

		await openPalette(page);
		await page.keyboard.press("Escape");
		await expect(palette(page)).toBeHidden();

		await page.getByTestId("open-search").click();
		await expect(palette(page)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(palette(page)).toBeHidden();
	} finally {
		for (const s of seeded) rmSync(s.path, { force: true });
	}
});

test("typing finds chats by title and Escape clears before it closes", async ({ page }) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	await openFixtureProject(page);
	const seeded = seedAttention(repo);
	try {
		await page.reload();
		await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-attention", "true");
		await openPalette(page);
		await page.getByTestId("search-input").fill("unread result");
		const chats = page.locator('[data-testid="search-row"][data-kind="chat"]');
		await expect(chats.first()).toContainText("Unread result chat");
		await expect(page.locator("mark").first()).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByTestId("search-input")).toHaveValue("");
		await expect(palette(page)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(palette(page)).toBeHidden();
	} finally {
		for (const s of seeded) rmSync(s.path, { force: true });
	}
});

test("commands run from the palette and show their shortcut", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const bottom = page.getByTestId("bottom-panel");
	const before = await bottom.count();

	await openPalette(page);
	await page.getByTestId("search-input").fill(">bottom");
	await expect(page.locator('[data-testid="search-chip"][data-scope="commands"]')).toHaveAttribute(
		"data-active",
		"true",
	);
	const row = page.locator('[data-testid="search-row"][data-item-id="command:view.toggleBottom"]');
	await expect(row).toBeVisible();
	await expect(row.locator("kbd")).not.toHaveCount(0);
	await page.keyboard.press("Enter");
	await expect(palette(page)).toBeHidden();
	await expect(bottom).toHaveCount(before === 0 ? 1 : 0);
});

test("the Settings page opens a section, and Backspace on an empty query goes back", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("open settings");
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("search-crumb")).toHaveText("Settings");

	await page.keyboard.press("Backspace");
	await expect(page.getByTestId("search-crumb")).toHaveCount(0);

	await page.getByTestId("search-input").fill("open settings");
	await page.keyboard.press("Enter");
	await page.getByTestId("search-input").fill("appearance");
	await page.keyboard.press("Enter");
	await expect(palette(page)).toBeHidden();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await expect(page.getByTestId("settings-nav-appearance")).toHaveAttribute("data-active", "true");
});

test("double Shift toggles the palette and can be turned off in Settings › Keyboard", async ({
	page,
}) => {
	await openFixtureProject(page);
	await doubleShift(page);
	await expect(palette(page)).toBeVisible();
	await doubleShift(page);
	await expect(palette(page)).toBeHidden();

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-keyboard").click();
	const toggle = page.getByTestId("settings-double-shift");
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();

	await doubleShift(page);
	await page.waitForTimeout(400);
	await expect(palette(page)).toBeHidden();

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await doubleShift(page);
	await page.waitForTimeout(400);
	await expect(palette(page)).toBeHidden();
});

test("the Extensions page flips a host-backed switch in place and the switch survives a reload", async ({
	page,
}) => {
	await openFixtureProject(page);
	const row = page.locator('[data-testid="search-row"][data-item-id="extension:visualize"]');
	const openPage = async () => {
		await openPalette(page);
		await page.getByTestId("search-input").fill(">extensions");
		await page
			.locator('[data-testid="search-row"][data-item-id="command:settings.extensions"]')
			.click();
		await expect(page.getByTestId("search-crumb")).toContainText("Extensions");
		await expect(row).toBeVisible();
	};
	try {
		await openPage();
		await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "true");
		await row.click();
		await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "false");
		await expect(palette(page)).toBeVisible();
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		await expect(palette(page)).toBeHidden();

		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await openPage();
		await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "false");
	} finally {
		if ((await row.getByTestId("search-toggle").getAttribute("data-on")) === "false") {
			await row.click();
			await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "true");
		}
	}
});

test("inline toggles keep the palette open and Ctrl+R stays inert under it", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("double shift");
	const row = page.locator('[data-testid="search-row"][data-item-id="setting:double-shift"]');
	await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "true");
	await page.keyboard.press("Enter");
	await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "false");
	await expect(palette(page)).toBeVisible();

	await page.keyboard.press("Control+r");
	await expect(palette(page)).toBeVisible();
	await expect(page.getByTestId("history-overlay")).toHaveCount(0);
});
