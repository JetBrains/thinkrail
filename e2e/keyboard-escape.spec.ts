import { realpathSync, rmSync, utimesSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openWorkspaceChat,
	pressPlatformShortcut,
	revealWorkbenchTool,
	visibleTerminal,
	waitTerminalReady,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_701_400_000_000;

test.use({ viewport: { width: 1280, height: 760 } });

const hints = (page: Page) => page.getByTestId("hint-mode");
const feed = (page: Page) => page.locator("[data-transcript-feed]");
const regionOf = (page: Page, inside: Locator) =>
	page.locator("[data-region]").filter({ has: inside });

function seedChat() {
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "escape leaves the field",
		messages: [
			{ role: "user", text: "Where do uploads fail?", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "The client gives up on the first error.",
				stopReason: "stop",
				timestamp: BASE_TS + 1_000,
			},
			{ role: "user", text: "Summarize it once more.", timestamp: BASE_TS + 2_000 },
			{
				role: "assistant",
				text: "Summary: retry the upload before giving up.",
				stopReason: "stop",
				timestamp: BASE_TS + 3_000,
			},
		],
	});
	utimesSync(session.path, new Date(BASE_TS + 50_000), new Date(BASE_TS + 50_000));
	return session;
}

async function openSeededChat(page: Page) {
	await openFixtureProject(page);
	const session = seedChat();
	await enterDefaultWorkspace(page);
	await expect(
		page.locator("[data-chat-row-id]").filter({ hasText: "Summary: retry the upload" }),
	).toBeVisible();
	return session;
}

test("Esc leaves the composer for the message feed: the draft stays, F shows hints, arrows walk", async ({
	page,
}) => {
	const session = await openSeededChat(page);
	try {
		const input = page.getByTestId("chat-input");
		const region = regionOf(page, input);
		await input.fill("draft text");
		await input.press("Home");
		for (let step = 0; step < 3; step += 1) await input.press("ArrowRight");

		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();
		await expect(feed(page)).toHaveCSS("outline-style", "none");
		await expect(region).toHaveAttribute("data-region-active", "");
		await expect(input).toHaveValue("draft text");

		await page.keyboard.press("f");
		await expect(hints(page)).toBeVisible();
		await expect(page.getByTestId("hint-label").first()).toBeVisible();
		await page.screenshot({ path: test.info().outputPath("esc-hints.png") });
		await page.keyboard.press("Escape");
		await expect(hints(page)).toHaveCount(0);
		await expect(feed(page)).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();
		await expect(input).not.toBeFocused();

		await page.keyboard.press("ArrowDown");
		const current = page.locator("[data-transcript-current]");
		await expect(current).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(input).toBeFocused();
		await expect(input).toHaveValue("draft text");
		expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(3);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("the @ menu takes the first Esc and the second one leaves the composer", async ({ page }) => {
	const session = await openSeededChat(page);
	try {
		const input = page.getByTestId("chat-input");
		await input.focus();
		await input.pressSequentially("@READ");
		const mentions = page.getByTestId("mention-menu");
		await expect(mentions).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(mentions).toHaveCount(0);
		await expect(input).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();
		await expect(input).toHaveValue("@READ");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("Esc leaves a panel's text field for the panel, which keeps its accent line", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	await revealWorkbenchTool(page, "plan");
	const input = page.getByTestId("plan-rail-pane").getByTestId("todo-add-input");
	const region = regionOf(page, input);
	await input.fill("half a task");
	await expect(region).toHaveAttribute("data-region-active", "");

	await page.keyboard.press("Escape");
	await expect(region).toBeFocused();
	await expect(region).toHaveAttribute("data-region-active", "");
	await expect(region).toHaveCSS("outline-style", "none");
	await expect(input).toHaveValue("half a task");

	await page.keyboard.press("f");
	await expect(hints(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(hints(page)).toHaveCount(0);
	await expect(region).toBeFocused();

	const center = regionOf(page, page.getByTestId("chat-input"));
	await pressPlatformShortcut(page, "1");
	await expect(center).toHaveAttribute("data-region-active", "");
	await expect(region).not.toHaveAttribute("data-region-active", "");
	await expect
		.poll(() => center.evaluate((root) => root.contains(document.activeElement)))
		.toBe(true);
});

test("Esc in a Settings field still closes Settings", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-keyboard").click();
	const filter = page.getByTestId("keybinding-filter");
	await filter.fill("split");
	await expect(filter).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
});

test("Esc in the terminal reaches the shell and keeps focus there", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const field = visibleTerminal(page).locator(".xterm-helper-textarea");
	await field.focus();
	await page.keyboard.type("head -c1 | od -An -c");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await expect(field).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(visibleTerminal(page).locator(".xterm-rows")).toContainText("033");
	await expect(field).toBeFocused();
});

test("Esc climbs from a panel's field to the panel, then to the chat feed, from a tree, a tab and the top bar too", async ({
	page,
}) => {
	const session = await openSeededChat(page);
	try {
		await revealWorkbenchTool(page, "plan");
		const input = page.getByTestId("plan-rail-pane").getByTestId("todo-add-input");
		const panel = regionOf(page, input);
		await input.fill("half a task");
		await page.keyboard.press("Escape");
		await expect(panel).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();
		await expect(feed(page)).toHaveCSS("outline-style", "none");
		await expect(regionOf(page, feed(page))).toHaveAttribute("data-region-active", "");
		await expect(input).toHaveValue("half a task");
		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();

		await pressPlatformShortcut(page, "Shift+E");
		const row = page.locator('[data-testid="file-node"]:focus');
		await expect(row).toHaveCount(1);
		await page.keyboard.press("ArrowDown");
		await expect(row).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();

		await page.locator('[data-testid="editor-tab"][data-kind="chat"]').getByRole("tab").focus();
		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();

		await page.getByTestId("open-settings").focus();
		await page.keyboard.press("Escape");
		await expect(feed(page)).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("Esc on a side or bottom rail's tool button climbs to the chat feed", async ({ page }) => {
	const session = await openSeededChat(page);
	try {
		const rails = [
			page.getByTestId("left-layout-rail"),
			page.getByTestId("right-layout-rail"),
			page.getByTestId("bottom-tool-rail"),
		];
		for (const rail of rails) {
			const control = rail.locator("[data-rail-entry], [data-rail-action]").first();
			await control.focus();
			await expect(control).toBeFocused();
			await page.keyboard.press("Escape");
			await expect(feed(page)).toBeFocused();
		}
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("Esc on a Files row or a tab lands in the editor of the file the center shows, and Monaco keeps its Esc", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");
	await page
		.getByRole("tree", { name: "Files" })
		.getByTestId("file-node")
		.filter({ hasText: /^notes\.txt/ })
		.dblclick();
	await expect(page.locator('[data-testid="editor-pane"]:visible .monaco-editor')).toBeVisible();
	const notes = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await expect(notes).toHaveAttribute("data-active", "true");
	const inEditor = () =>
		page.evaluate(() => document.activeElement?.closest(".monaco-editor") != null);

	await pressPlatformShortcut(page, "Shift+E");
	const row = page.locator('[data-testid="file-node"]:focus');
	await expect(row).toHaveCount(1);
	await page.keyboard.press("ArrowUp");
	await expect(row).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect.poll(inEditor).toBe(true);
	await expect(notes).toHaveAttribute("data-active", "true");

	await page.keyboard.press("Escape");
	await expect.poll(inEditor).toBe(true);

	await notes.getByRole("tab").focus();
	await page.keyboard.press("Escape");
	await expect.poll(inEditor).toBe(true);

	await waitTerminalReady(page);
	await page.getByTestId("terminal-tab").first().getByRole("tab").focus();
	await page.keyboard.press("Escape");
	await expect.poll(inEditor).toBe(true);
	await expect(notes).toHaveAttribute("data-active", "true");
});

test("Esc on a dialog's button closes the dialog and climbs no further", async ({ page }) => {
	const session = await openSeededChat(page);
	try {
		await page.getByTestId("open-settings").click();
		const dialog = page.getByTestId("settings-dialog");
		await expect(dialog).toBeVisible();
		await page.getByTestId("settings-nav-keyboard").focus();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(feed(page)).not.toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("on Project Home, Esc on the Projects tree lands in the main pane", async ({ page }) => {
	await openFixtureProject(page);
	await pressPlatformShortcut(page, "0");
	const projects = page.locator('[data-region-kind="home"]');
	await expect
		.poll(() => projects.evaluate((region) => region.contains(document.activeElement)))
		.toBe(true);
	await page.keyboard.press("Escape");
	await expect
		.poll(() => page.evaluate(() => document.activeElement?.closest("[data-main-area]") != null))
		.toBe(true);
});
