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
import { E2eWire } from "./fixtures/wire";

const BASE_TS = 1_704_000_000_000;
const askArgs = {
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
} satisfies AskUserQuestionArgs;

function palette(page: Page) {
	return page.getByTestId("search-palette");
}

async function openPalette(page: Page): Promise<void> {
	await pressPlatformShortcut(page, "k");
	await expect(palette(page)).toBeVisible();
	await expect(page.getByTestId("search-input")).toBeFocused();
}

async function doubleShift(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const type of ["keydown", "keyup", "keydown", "keyup"]) {
			window.dispatchEvent(
				new KeyboardEvent(type, { key: "Shift", code: "ShiftLeft", bubbles: true }),
			);
		}
	});
}

async function composingKey(page: Page, key: string, sentinel = false): Promise<void> {
	await page.getByTestId("search-input").evaluate(
		(input, init) => {
			const event = new KeyboardEvent("keydown", {
				key: init.key,
				bubbles: true,
				cancelable: true,
				isComposing: !init.sentinel,
			});
			if (init.sentinel) Object.defineProperty(event, "keyCode", { get: () => 229 });
			input.dispatchEvent(event);
		},
		{ key, sentinel },
	);
}

async function nextFrame(page: Page): Promise<void> {
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

function chip(page: Page, scope: string) {
	return page.locator(`[data-testid="search-chip"][data-scope="${scope}"]`);
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
		await expect(page.getByTestId("open-search")).toBeFocused();
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
		await expect(palette(page).locator("mark").first()).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByTestId("search-input")).toHaveValue("");
		await expect(palette(page)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(palette(page)).toBeHidden();

		await openPalette(page);
		await page.getByTestId("search-input").fill("unread");
		await page.getByTestId("search-input").evaluate((input) =>
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					code: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		await expect(palette(page)).toBeHidden();
	} finally {
		for (const s of seeded) rmSync(s.path, { force: true });
	}
});

test("a chat in a workspace this window never opened is found by its title, renamed by a peer, with no chat listing", async ({
	page,
}) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	const sent: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			sent.push(message.toString());
			server.send(message);
		});
	});
	await openFixtureProject(page);
	const seeded = seedWorkspaceSession(repo, {
		name: "Zebra migration plan",
		messages: [
			{ role: "user", text: "move the tables", timestamp: BASE_TS + 20 },
			{ role: "assistant", text: "moved", timestamp: BASE_TS + 21 },
		],
	});
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-attention", "true");
		sent.length = 0;

		await openPalette(page);
		const input = page.getByTestId("search-input");
		const row = palette(page).locator(
			`[data-testid="search-row"][data-item-id="chat:${seeded.id}"]`,
		);
		await input.fill("zebra");
		await expect(row).toContainText("Zebra migration plan");
		await expect(row.locator("mark")).toHaveText("Zebra");

		const project = (await wire.request("project.list", {}))[0];
		if (!project) throw new Error("fixture project missing");
		const workspace = (await wire.request("workspace.list", { projectId: project.id })).find(
			(candidate) => candidate.kind === "default",
		);
		if (!workspace) throw new Error("default workspace missing");
		await wire.request("session.rename", {
			sessionId: seeded.id,
			workspaceId: workspace.id,
			title: "Yak shaving notes",
		});
		await input.fill("yak");
		await expect(row).toContainText("Yak shaving notes");
		expect(sent.filter((frame) => frame.includes('"method":"session.list"'))).toEqual([]);
	} finally {
		wire.close();
		rmSync(seeded.path, { force: true });
	}
});

test("commands run from the palette and show their shortcut", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const bottom = page.getByTestId("bottom-panel");
	await expect(bottom).toBeVisible();

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
	await expect(bottom).toHaveCount(0);
});

test("a Settings section row opens that section, and Mod+K inside the palette closes it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openPalette(page);
	await pressPlatformShortcut(page, "k");
	await expect(palette(page)).toBeHidden();

	await openPalette(page);
	await page.getByTestId("search-input").fill(">appearance");
	await expect(
		page.locator('[data-testid="search-row"][data-item-id="setting:appearance"]'),
	).toBeVisible();
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
	const settings = page.getByTestId("settings-dialog");
	await expect(settings).toBeVisible();
	await doubleShift(page);
	await nextFrame(page);
	await expect(palette(page)).toHaveCount(0);

	await page.getByTestId("settings-nav-keyboard").click();
	const toggle = page.getByTestId("settings-double-shift");
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await settings.getByRole("button", { name: "Close" }).click();
	await expect(settings).toBeHidden();

	await doubleShift(page);
	await openPalette(page);
	await page.keyboard.press("Escape");
	await expect(palette(page)).toBeHidden();

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await doubleShift(page);
	await openPalette(page);
});

test("the double-Shift row opens Settings › Keyboard, and Ctrl+R stays inert under the palette", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("new-chat").first().click();
	const composer = page.getByTestId("chat-input");
	await composer.focus();
	await openPalette(page);
	await page.keyboard.press("Escape");
	await expect(palette(page)).toBeHidden();
	await expect(composer).toBeFocused();

	await openPalette(page);
	await page.keyboard.press("Control+r");
	await expect(palette(page)).toBeVisible();
	await expect(page.getByTestId("history-overlay")).toHaveCount(0);

	await page.getByTestId("search-input").fill("double shift");
	await page.locator('[data-testid="search-row"][data-item-id="setting:double-shift"]').click();
	await expect(palette(page)).toBeHidden();
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await expect(page.getByTestId("settings-nav-keyboard")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("settings-double-shift")).toBeVisible();
});

test("an active IME owns Escape, arrows, Tab and Enter in the palette input", async ({ page }) => {
	await openFixtureProject(page);
	await openPalette(page);
	const input = page.getByTestId("search-input");
	await input.fill(">settings");
	const rows = page.getByTestId("search-row");
	await expect(rows.first()).toHaveAttribute("aria-selected", "true");

	await composingKey(page, "ArrowDown");
	await composingKey(page, "Tab");
	await composingKey(page, "Escape");
	await composingKey(page, "Enter", true);
	await expect(palette(page)).toBeVisible();
	await expect(input).toHaveValue(">settings");
	await expect(chip(page, "commands")).toHaveAttribute("data-active", "true");
	await expect(rows.first()).toHaveAttribute("aria-selected", "true");

	await page.keyboard.press("ArrowDown");
	await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Escape");
	await expect(input).toHaveValue("");
});

test("keys still reach the palette after a click lands outside the input", async ({ page }) => {
	await openFixtureProject(page);
	await openPalette(page);
	const input = page.getByTestId("search-input");
	await input.fill(">settings");
	const header = page.locator('[data-testid="search-section"] [role="presentation"]').first();

	await header.click();
	await page.keyboard.press("Control");
	await expect(input).not.toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(page.getByTestId("search-row").nth(1)).toHaveAttribute("aria-selected", "true");
	await expect(input).toBeFocused();

	await header.click();
	await page.keyboard.press("Escape");
	await expect(input).toHaveValue("");
	await expect(palette(page)).toBeVisible();

	await page
		.getByTestId("search-palette-body")
		.locator("footer")
		.click({ position: { x: 4, y: 4 } });
	await pressPlatformShortcut(page, "k");
	await expect(palette(page)).toBeHidden();
});

test("Tab, Alt+digit and the chips switch the scope and write its prefix", async ({ page }) => {
	await openFixtureProject(page);
	await openPalette(page);
	const input = page.getByTestId("search-input");
	await input.fill("auth");

	await page.keyboard.press("Tab");
	await expect(chip(page, "work")).toHaveAttribute("aria-pressed", "true");
	await expect(input).toHaveValue("@auth");
	await page.keyboard.press("Shift+Tab");
	await expect(chip(page, "all")).toHaveAttribute("aria-pressed", "true");
	await expect(input).toHaveValue("auth");
	if (!(await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "")))) {
		await page.keyboard.press("Alt+3");
		await expect(input).toHaveValue(">auth");
	}
	await chip(page, "work").click();
	await expect(input).toHaveValue("@auth");
	await expect(input).toBeFocused();

	const preview = page.getByTestId("search-preview-toggle");
	await page.keyboard.press("ControlOrMeta+Shift+KeyI");
	await pressPlatformShortcut(page, "i");
	await expect(preview).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("ControlOrMeta+Alt+KeyI");
	await pressPlatformShortcut(page, "i");
	await expect(preview).toHaveAttribute("aria-pressed", "false");
});
