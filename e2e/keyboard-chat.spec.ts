import { existsSync, realpathSync, rmSync, utimesSync } from "node:fs";
import { expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
	closeSettings,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	pressPlatformShortcut,
} from "./fixtures/app";
import {
	moveMouseToChatViewport,
	readChatScrollGeometry,
	waitForScrollStability,
} from "./fixtures/chatScroll";
import { resetKeybindings, setKeybindings } from "./fixtures/keybindings";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { interceptAppWire, textStreamReplay } from "./fixtures/streamReplay";

const BASE_TS = 1_701_300_000_000;
const repoCwd = () => realpathSync(E2E_FIXTURE_REPO);

test.use({ viewport: { width: 1280, height: 760 } });

function seedToolChat(name = "keyboard transcript") {
	const session = seedWorkspaceSession(repoCwd(), {
		name,
		messages: [
			{ role: "user", text: "Find where uploads fail.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "read-readme", name: "read", arguments: { path: "README.md" } },
					{ type: "thinking", thinking: "I should check the notes next." },
					{ type: "toolCall", id: "read-notes", name: "read", arguments: { path: "notes.txt" } },
					{ type: "toolCall", id: "bash-ls", name: "bash", arguments: { command: "ls" } },
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			...(
				[
					["read-readme", "read", "# sample-project"],
					["read-notes", "read", "plain-text-fixture"],
					["bash-ls", "bash", "README.md\nnotes.txt"],
				] as const
			).map(([toolCallId, toolName, text], index) => ({
				role: "toolResult" as const,
				toolCallId,
				toolName,
				content: [{ type: "text" as const, text }],
				isError: false,
				timestamp: BASE_TS + 2_000 + index,
			})),
			{
				role: "assistant",
				text: "Uploads fail because the client gives up on the first error.",
				stopReason: "stop",
				timestamp: BASE_TS + 3_000,
			},
			{ role: "user", text: "Thanks, summarize again.", timestamp: BASE_TS + 4_000 },
			{
				role: "assistant",
				text: "Summary: nothing else to report.",
				stopReason: "stop",
				timestamp: BASE_TS + 5_000,
			},
		],
	});
	utimesSync(session.path, new Date(BASE_TS + 50_000), new Date(BASE_TS + 50_000));
	return session;
}

function seedTallChat(name: string, needleAt = -1) {
	const session = seedWorkspaceSession(repoCwd(), {
		name,
		messages: Array.from({ length: 40 }, (_, index) => [
			{
				role: "user" as const,
				text: `request ${index + 1}: walk the tall keyboard fixture`,
				timestamp: BASE_TS + index * 2_000,
			},
			{
				role: "assistant" as const,
				text:
					index === needleAt
						? "obsidian-keyboard-needle marks the jump target"
						: `answer ${index + 1}: ${"the tall keyboard fixture keeps going. ".repeat(6)}`,
				timestamp: BASE_TS + index * 2_000 + 1_000,
			},
		]).flat(),
	});
	utimesSync(session.path, new Date(BASE_TS + 100_000), new Date(BASE_TS + 100_000));
	return session;
}

async function selectMessageOrder(page: Page, order: "oldest-first" | "newest-first") {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId(`chat-order-${order}`);
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await closeSettings(page);
}

const row = (page: Page, text: string): Locator =>
	page.locator("[data-chat-row-id]").filter({ hasText: text });
const item = (page: Page, id: string): Locator => page.locator(`[data-transcript-item="${id}"]`);
const thinkingItem = (page: Page): Locator =>
	page.locator('article[data-transcript-item$=":thinking:1"]');
const activityRow = (page: Page): Locator => page.locator('[data-chat-row-id^="activity:"]');

async function enterTranscript(page: Page): Promise<void> {
	await page.getByTestId("chat-input").focus();
	await pressPlatformShortcut(page, "ArrowUp");
}

async function focusInsideTranscript(page: Page): Promise<boolean> {
	return page.evaluate(
		() =>
			document
				.querySelector('[data-testid="chat-transcript-scroll"]')
				?.contains(document.activeElement) === true,
	);
}

async function openToolChat(page: Page) {
	await openFixtureProject(page);
	const session = seedToolChat();
	await enterDefaultWorkspace(page);
	await expect(row(page, "Summary: nothing else to report.")).toBeVisible();
	return session;
}

test("Mod+↑ enters at the newest message, arrows and j/k walk it, Esc returns with the draft intact", async ({
	page,
}) => {
	const session = await openToolChat(page);
	try {
		const input = page.getByTestId("chat-input");
		await input.fill("draft text");
		await input.press("Home");
		for (let step = 0; step < 3; step += 1) await input.press("ArrowRight");
		await pressPlatformShortcut(page, "ArrowUp");
		const newest = row(page, "Summary: nothing else to report.");
		await expect(newest).toBeFocused();
		await expect(newest).toHaveAttribute("data-transcript-current", "true");
		await expect(page.locator("[data-transcript-current]")).toHaveCount(1);

		await page.keyboard.press("ArrowUp");
		await expect(row(page, "Thanks, summarize again.")).toBeFocused();
		await page.keyboard.press("k");
		await page.keyboard.press("k");
		const answer = row(page, "Uploads fail because the client gives up");
		await expect(answer).toBeFocused();
		await page.keyboard.press("j");
		await page.keyboard.press("ArrowDown");
		await expect(row(page, "Thanks, summarize again.")).toBeFocused();
		await page.keyboard.press("Home");
		await expect(row(page, "Find where uploads fail.")).toBeFocused();
		await page.keyboard.press("End");
		await expect(page.locator('[data-chat-row-id$=":divider"]').last()).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(input).toBeFocused();
		await expect(input).toHaveValue("draft text");
		expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(3);

		await input.fill("first line\nsecond line");
		await pressPlatformShortcut(page, "ArrowUp");
		await expect(input).toBeFocused();
		expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0);
		await pressPlatformShortcut(page, "ArrowUp");
		await expect(newest).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("→ expands an activity group and walks into nested steps, ← climbs back out", async ({
	page,
}) => {
	const session = await openToolChat(page);
	try {
		await enterTranscript(page);
		await page.keyboard.press("Home");
		await page.keyboard.press("j");
		const activity = activityRow(page);
		await expect(activity).toBeFocused();
		await expect(activity.getByTestId("activity-group-toggle")).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		await page.keyboard.press("ArrowRight");
		await expect(activity.getByTestId("activity-group-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await expect(activity).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(item(page, "read-readme")).toBeFocused();
		await page.keyboard.press("j");
		const thinking = thinkingItem(page);
		await expect(thinking).toBeFocused();
		await page.keyboard.press("l");
		await expect(thinking.getByTestId("thinking-group-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await page.keyboard.press("l");
		await expect(item(page, "read-notes")).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(item(page, "bash-ls")).toBeFocused();
		await page.keyboard.press("h");
		await expect(thinking).toBeFocused();
		await page.keyboard.press("h");
		await expect(thinking.getByTestId("thinking-group-toggle")).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		await page.keyboard.press("ArrowLeft");
		await expect(activity).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(activity.getByTestId("activity-group-toggle")).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		await expect(item(page, "read-readme")).toHaveCount(0);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("C copies, O opens a preview tab and Shift+F10 opens the item menu", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	const session = await openToolChat(page);
	try {
		await enterTranscript(page);
		await page.keyboard.press("c");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("Summary: nothing else to report.");

		await page.keyboard.press("Home");
		await page.keyboard.press("j");
		await page.keyboard.press("l");
		await page.keyboard.press("l");
		const step = item(page, "read-readme");
		await expect(step).toBeFocused();
		await page.keyboard.press("c");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("# sample-project");

		await page.keyboard.press("Shift+F10");
		const menu = page.getByTestId("chat-item-menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByRole("menuitem")).toHaveText(["Expand", "Copy", "Open file"]);
		await page.keyboard.press("Escape");
		await expect(menu).toHaveCount(0);
		await expect(step).toBeFocused();

		await page.keyboard.press("Shift+F10");
		await page.getByTestId("chat-item-menu-expand").click();
		await expect(step.getByTestId("activity-step-toggle")).toHaveAttribute("aria-expanded", "true");
		await expect(step).toBeFocused();

		await page.keyboard.press("o");
		const fileTab = page.locator('[data-testid="editor-tab"][data-kind="file"]');
		await expect(fileTab).toHaveCount(1);
		await expect(fileTab).toContainText("README.md");
		await expect(fileTab).toHaveAttribute("data-preview", "true");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("Tab from an item walks only its own controls, then leaves the transcript", async ({
	page,
}) => {
	const session = await openToolChat(page);
	try {
		await enterTranscript(page);
		await page.keyboard.press("k");
		await page.keyboard.press("k");
		await page.keyboard.press("k");
		const answer = row(page, "Uploads fail because the client gives up");
		await expect(answer).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(answer.getByTestId("chat-copy")).toBeFocused();
		await page.keyboard.press("Tab");
		expect(await focusInsideTranscript(page)).toBe(false);
		await page.keyboard.press("Shift+Tab");
		await expect(answer).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		expect(await focusInsideTranscript(page)).toBe(false);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("PgUp/PgDn in the composer scroll the transcript and Latest from the keyboard lands on the newest message", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedTallChat("keyboard paging");
	try {
		await enterDefaultWorkspace(page);
		const chatScroll = page.getByTestId("chat-scroll");
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		await waitForScrollStability(chatScroll);
		const input = page.getByTestId("chat-input");
		await input.focus();
		const start = (await readChatScrollGeometry(chatScroll)).scrollTop;
		await input.press("PageUp");
		await expect
			.poll(async () => (await readChatScrollGeometry(chatScroll)).scrollTop)
			.toBeLessThan(start - 100);
		await expect(input).toBeFocused();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await input.press("PageUp");
		await waitForScrollStability(chatScroll);
		const raised = (await readChatScrollGeometry(chatScroll)).scrollTop;
		await input.press("PageDown");
		await expect
			.poll(async () => (await readChatScrollGeometry(chatScroll)).scrollTop)
			.toBeGreaterThan(raised + 100);
		await expect(input).toBeFocused();

		const latest = page.getByTestId("scroll-to-bottom");
		await expect(latest).toBeVisible();
		await latest.focus();
		await page.keyboard.press("Enter");
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		await expect(row(page, "answer 40:")).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

function seedTallLatestActivity(name: string) {
	const reads = Array.from({ length: 30 }, (_, index) => `read-${index + 1}`);
	const session = seedWorkspaceSession(repoCwd(), {
		name,
		messages: [
			...Array.from({ length: 30 }, (_, index) => [
				{
					role: "user" as const,
					text: `older request ${index + 1}`,
					timestamp: BASE_TS + index * 2_000,
				},
				{
					role: "assistant" as const,
					text: `older answer ${index + 1}: ${"history keeps going. ".repeat(8)}`,
					timestamp: BASE_TS + index * 2_000 + 1_000,
				},
			]).flat(),
			{ role: "user", text: "Read every file.", timestamp: BASE_TS + 100_000 },
			{
				role: "assistant",
				content: reads.map((id) => ({
					type: "toolCall" as const,
					id,
					name: "read",
					arguments: { path: "README.md" },
				})),
				stopReason: "toolUse",
				timestamp: BASE_TS + 101_000,
			},
			...reads.map((toolCallId, index) => ({
				role: "toolResult" as const,
				toolCallId,
				toolName: "read",
				content: [{ type: "text" as const, text: "# sample-project" }],
				isError: false,
				timestamp: BASE_TS + 102_000 + index,
			})),
		],
	});
	utimesSync(session.path, new Date(BASE_TS + 200_000), new Date(BASE_TS + 200_000));
	return session;
}

test("a nested step of the newest group is revealed itself when its row comes back", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedTallLatestActivity("keyboard tall latest group");
	try {
		await enterDefaultWorkspace(page);
		const chatScroll = page.getByTestId("chat-scroll");
		await waitForScrollStability(chatScroll);
		await enterTranscript(page);
		const group = activityRow(page);
		await expect(group).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowRight");
		const first = item(page, "read-1");
		await expect(first).toBeFocused();
		await expect(first).toBeInViewport();

		await moveMouseToChatViewport(page, chatScroll);
		for (let notch = 0; notch < 60 && (await first.count()) > 0; notch += 1) {
			await page.mouse.wheel(0, -400);
			await page.evaluate(() => new Promise(requestAnimationFrame));
		}
		await expect(first).toHaveCount(0);
		await expect(page.locator("[data-transcript-feed]")).toBeFocused();

		await page.keyboard.press("k");
		await expect(first).toBeFocused();
		await waitForScrollStability(chatScroll);
		await expect(first).toBeInViewport();
	} finally {
		rmSync(session.path, { force: true });
	}
});

async function openShortTallLatestActivity(page: Page, name: string) {
	await openFixtureProject(page);
	const session = seedTallLatestActivity(name);
	await enterDefaultWorkspace(page);
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);
	await page.getByTestId("chat-input").focus();
	await page.keyboard.press("Control+Backquote");
	await expect(page.getByTestId("bottom-panel")).toBeVisible();
	const chatScroll = page.getByTestId("chat-scroll");
	await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	await waitForScrollStability(chatScroll);
	return { session, chatScroll };
}

test("a keyboard expand of the newest group in a short chat leaves follow and keeps the focused header and step on screen", async ({
	page,
}) => {
	const { session, chatScroll } = await openShortTallLatestActivity(
		page,
		"keyboard short latest group",
	);
	try {
		await enterTranscript(page);
		const group = activityRow(page);
		const toggle = group.getByTestId("activity-group-toggle");
		await expect(group).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await waitForScrollStability(chatScroll);
		await expect(group).toBeFocused();
		await expect(toggle).toBeInViewport();

		await page.keyboard.press("ArrowRight");
		const first = item(page, "read-1");
		await expect(first).toBeFocused();
		await waitForScrollStability(chatScroll);
		await expect(first).toBeInViewport();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("keyboard focus entering an on-screen step of the newest group leaves follow without scrolling", async ({
	page,
}) => {
	const { session, chatScroll } = await openShortTallLatestActivity(
		page,
		"keyboard short latest step",
	);
	try {
		const toggle = activityRow(page).getByTestId("activity-group-toggle");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await waitForScrollStability(chatScroll);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		const last = item(page, "read-30");
		await expect(last).toBeInViewport();

		await enterTranscript(page);
		await expect(activityRow(page)).toBeFocused();
		const before = (await readChatScrollGeometry(chatScroll)).scrollTop;
		await page.keyboard.press("End");
		await expect(page.locator('[data-chat-row-id$=":divider"]').last()).toBeFocused();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		await page.keyboard.press("ArrowUp");
		await expect(last).toBeFocused();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
		await waitForScrollStability(chatScroll);
		expect(
			Math.abs((await readChatScrollGeometry(chatScroll)).scrollTop - before),
		).toBeLessThanOrEqual(1);
		await expect(last).toBeInViewport();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("the focused item keeps the keyboard when its row unmounts, and the next key brings it back", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedTallChat("keyboard virtualization");
	try {
		await enterDefaultWorkspace(page);
		const chatScroll = page.getByTestId("chat-scroll");
		await waitForScrollStability(chatScroll);
		await enterTranscript(page);
		const newest = row(page, "answer 40:");
		await expect(newest).toBeFocused();

		await moveMouseToChatViewport(page, chatScroll);
		for (let notch = 0; notch < 40 && (await newest.count()) > 0; notch += 1) {
			await page.mouse.wheel(0, -400);
			await page.evaluate(() => new Promise(requestAnimationFrame));
		}
		await expect(newest).toHaveCount(0);
		await expect(page.locator("[data-transcript-feed]")).toBeFocused();
		await expect(page.getByTestId("chat-input")).not.toBeFocused();

		await page.keyboard.press("k");
		await expect(newest).toBeFocused();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("a history jump focuses the message it revealed", async ({ page }) => {
	await openFixtureProject(page);
	const session = seedTallChat("keyboard jump", 5);
	try {
		await page.waitForTimeout(2_100);
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await enterDefaultWorkspace(page);
		await page.getByTestId("chat-input").press("Control+r");
		const query = page.getByTestId("history-query");
		await query.fill("obsidian-keyboard-needle");
		await expect(page.getByTestId("history-expand-hint")).toBeVisible();
		await query.press("Tab");
		await expect(
			page
				.locator('[data-testid="history-item"][data-kind="message"]')
				.filter({ hasText: "obsidian-keyboard-needle" }),
		).toBeVisible();
		await query.press("Enter");
		await expect(page.getByTestId("history-overlay")).toBeHidden();
		await expect(page.locator("[data-flash]")).toContainText("obsidian-keyboard-needle");
		await expect(row(page, "obsidian-keyboard-needle")).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("history entries take Delete and Shift+F10, and Tab still zooms", async ({ page }) => {
	await openFixtureProject(page);
	const doomed = seedWorkspaceSession(repoCwd(), {
		name: "doomed by key",
		messages: [{ role: "user", text: "trash me by keyboard", timestamp: BASE_TS }],
	});
	utimesSync(doomed.path, new Date(BASE_TS), new Date(BASE_TS));
	const menuChat = seedWorkspaceSession(repoCwd(), {
		name: "menu by key",
		messages: [{ role: "user", text: "menu entry by keyboard", timestamp: BASE_TS + 10_000 }],
	});
	utimesSync(menuChat.path, new Date(BASE_TS + 10_000), new Date(BASE_TS + 10_000));
	const kept = seedWorkspaceSession(repoCwd(), {
		name: "kept by key",
		messages: [{ role: "user", text: "keep this keyboard chat", timestamp: BASE_TS + 50_000 }],
	});
	utimesSync(kept.path, new Date(BASE_TS + 50_000), new Date(BASE_TS + 50_000));
	try {
		await enterDefaultWorkspace(page);
		await expect(page.getByText("keep this keyboard chat")).toBeVisible();
		const input = page.getByTestId("chat-input");
		const overlay = page.getByTestId("history-overlay");
		const query = page.getByTestId("history-query");

		await input.press("Control+r");
		await query.fill("menu entry by keyboard");
		const menuRow = page
			.locator('[data-testid="history-item"][data-kind="prompt"]')
			.filter({ hasText: "menu entry by keyboard" });
		await expect(menuRow).toHaveAttribute("data-selected", "true");
		await query.press("Home");
		await query.press("Delete");
		await expect(query).toHaveValue("enu entry by keyboard");
		await expect(overlay).toBeVisible();
		expect(existsSync(menuChat.path)).toBe(true);

		await query.fill("menu entry by keyboard");
		await expect(menuRow).toHaveAttribute("data-selected", "true");
		await query.press("Shift+F10");
		const menu = page.getByTestId("history-entry-menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByTestId("history-entry-save-template")).toBeVisible();
		await expect(menu.getByTestId("history-entry-delete")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveCount(0);
		await expect(overlay).toBeVisible();
		await expect(query).toBeFocused();
		await query.press("Tab");
		await expect(overlay).toHaveAttribute("data-stage", "zoomed");

		await query.fill("trash me by keyboard");
		const doomedRow = page
			.locator('[data-testid="history-item"][data-kind="prompt"]')
			.filter({ hasText: "trash me by keyboard" });
		await expect(doomedRow).toHaveAttribute("data-selected", "true");
		await query.press("End");
		await query.press("Delete");
		await expect(overlay).toHaveCount(0);
		await expect.poll(() => existsSync(doomed.path)).toBe(false);
	} finally {
		for (const session of [doomed, menuChat, kept]) rmSync(session.path, { force: true });
	}
});

test("the Resources inspector makes the transcript inert and lets the @ popup take Escape first", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedWorkspaceSession(repoCwd(), {
		name: "Resource keys",
		messages: [{ role: "user", text: "Inspect resources by keyboard.", timestamp: Date.now() }],
	});
	try {
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, "Resource keys");
		const trigger = page.getByTestId("resources-trigger");
		await trigger.click();
		const inspector = page.getByTestId("resources-inspector");
		await expect(inspector).toBeVisible();
		await expect(page.getByTestId("chat-transcript-scroll")).toHaveAttribute("inert", "");

		await trigger.focus();
		for (let press = 0; press < 12; press += 1) {
			await page.keyboard.press("Tab");
			expect(await focusInsideTranscript(page)).toBe(false);
		}

		const input = page.getByTestId("chat-input");
		await input.click();
		await input.pressSequentially("@READ");
		const mentions = page.getByTestId("mention-menu");
		await expect(mentions).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(mentions).toHaveCount(0);
		await expect(inspector).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(inspector).toHaveCount(0);
		await expect(trigger).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("Stop hands the keyboard back to the composer", async ({ page }) => {
	const wire = await interceptAppWire(page);
	await openFixtureProject(page);
	const title = "keyboard stop";
	const session = seedWorkspaceSession(repoCwd(), {
		name: title,
		messages: [{ role: "user", text: "Start streaming.", timestamp: BASE_TS }],
	});
	try {
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, title);
		const replay = textStreamReplay(session.id, "Streaming a long answer.", BASE_TS + 10_000);
		for (const frame of replay.steps.slice(0, 2).flat()) wire().send(frame);
		const stop = page.getByTestId("chat-abort");
		await expect(stop).toBeVisible();
		await stop.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("chat-input")).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("newest-first walks down from the newest message", async ({ page }) => {
	await openFixtureProject(page);
	await selectMessageOrder(page, "newest-first");
	const session = seedToolChat("keyboard newest first");
	try {
		await enterDefaultWorkspace(page);
		await enterTranscript(page);
		await expect(row(page, "Summary: nothing else to report.")).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(row(page, "Thanks, summarize again.")).toBeFocused();
		await page.keyboard.press("j");
		await page.keyboard.press("j");
		await expect(row(page, "Uploads fail because the client gives up")).toBeFocused();
		await page.keyboard.press("End");
		await expect(row(page, "Find where uploads fail.")).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("h/l walk a tab strip and j/k a side rail like their arrows", async ({ page }) => {
	const session = await openToolChat(page);
	try {
		await enterTranscript(page);
		await page.keyboard.press("Home");
		await page.keyboard.press("j");
		await page.keyboard.press("l");
		await page.keyboard.press("l");
		await page.keyboard.press("o");
		const fileTab = page.getByRole("tab", { name: /README\.md/ });
		await expect(fileTab).toHaveAttribute("aria-selected", "true");
		await fileTab.focus();
		await page.keyboard.press("h");
		const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]').getByRole("tab");
		await expect(chatTab).toBeFocused();
		await expect(chatTab).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("l");
		await expect(fileTab).toBeFocused();

		const specs = page.getByTestId("tool-rail-specs");
		const files = page.getByTestId("tool-rail-files");
		await specs.focus();
		await page.keyboard.press("j");
		await expect(files).toBeFocused();
		await page.keyboard.press("k");
		await expect(specs).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});

const SUBMIT_METHODS = new Set(["session.prompt", "session.steer", "session.followUp"]);

async function holdComposerSubmits(page: Page) {
	const submits: { method: string; text: string }[] = [];
	let socket: WebSocketRoute | null = null;
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		socket = browser;
		browser.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				id?: string;
				method?: string;
				params?: { text?: string };
			};
			if (frame.method && SUBMIT_METHODS.has(frame.method)) {
				submits.push({ method: frame.method, text: frame.params?.text ?? "" });
				browser.send(JSON.stringify({ id: frame.id, ok: true, result: { ok: true } }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => browser.send(message));
	});
	const wire = () => {
		if (!socket) throw new Error("The app wire is not connected");
		return socket;
	};
	return { submits, wire };
}

test.describe("rebound chat keys", () => {
	test.afterEach(async ({ page }) => resetKeybindings(page));

	test("a rebound copy key copies a transcript item and C no longer does", async ({ page }) => {
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
		const session = await openToolChat(page);
		const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
		try {
			await setKeybindings(page, { "transcript.copy": ["KeyY"] });
			await page.evaluate(() => navigator.clipboard.writeText(""));
			await enterTranscript(page);
			await expect(row(page, "Summary: nothing else to report.")).toBeFocused();
			await expect(async () => {
				await page.keyboard.press("y");
				expect(await clipboard()).toBe("Summary: nothing else to report.");
			}).toPass();

			await page.keyboard.press("k");
			await expect(row(page, "Thanks, summarize again.")).toBeFocused();
			await page.keyboard.press("c");
			expect(await clipboard()).toBe("Summary: nothing else to report.");
			await page.keyboard.press("y");
			await expect.poll(clipboard).toBe("Thanks, summarize again.");
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test("a transcript entry rebound onto Alt+↑ leaves an open @ menu for the transcript", async ({
		page,
	}) => {
		const session = await openToolChat(page);
		try {
			await setKeybindings(page, { "composer.enterTranscript": ["Alt+ArrowUp"] });
			const input = page.getByTestId("chat-input");
			await input.click();
			await input.pressSequentially("@READ");
			await expect(page.getByTestId("mention-menu")).toBeVisible();
			await page.keyboard.press("Alt+ArrowUp");
			await expect(row(page, "Summary: nothing else to report.")).toBeFocused();
		} finally {
			rmSync(session.path, { force: true });
		}
	});

	test("a history delete rebound onto Alt+Esc deletes the chat instead of closing the overlay", async ({
		page,
	}) => {
		await openFixtureProject(page);
		const doomed = seedWorkspaceSession(repoCwd(), {
			name: "doomed by chord",
			messages: [{ role: "user", text: "trash me by chord", timestamp: BASE_TS }],
		});
		utimesSync(doomed.path, new Date(BASE_TS), new Date(BASE_TS));
		try {
			await setKeybindings(page, { "history.deleteChat": ["Alt+Escape"] });
			await enterDefaultWorkspace(page);
			await page.getByTestId("chat-input").press("Control+r");
			const query = page.getByTestId("history-query");
			await query.fill("trash me by chord");
			await expect(
				page
					.locator('[data-testid="history-item"][data-kind="prompt"]')
					.filter({ hasText: "trash me by chord" }),
			).toHaveAttribute("data-selected", "true");
			await query.press("Alt+Escape");
			await expect.poll(() => existsSync(doomed.path)).toBe(false);
		} finally {
			rmSync(doomed.path, { force: true });
		}
	});

	test("a rebound follow-up chord queues while streaming and Mod+Enter no longer does", async ({
		page,
	}) => {
		const { submits, wire } = await holdComposerSubmits(page);
		await openFixtureProject(page);
		const title = "keyboard follow-up";
		const session = seedWorkspaceSession(repoCwd(), {
			name: title,
			messages: [{ role: "user", text: "Start streaming.", timestamp: BASE_TS }],
		});
		try {
			await setKeybindings(page, { "composer.followUp": ["Alt+KeyQ"] });
			await enterDefaultWorkspace(page);
			await openPersistedChat(page, title);
			const replay = textStreamReplay(session.id, "Streaming a long answer.", BASE_TS + 10_000);
			for (const frame of replay.steps.slice(0, 2).flat()) wire().send(frame);
			await expect(page.getByTestId("chat-abort")).toBeVisible();
			const input = page.getByTestId("chat-input");

			await input.fill("first follow-up");
			await expect(async () => {
				await page.keyboard.press("Alt+KeyQ");
				expect(submits).toEqual([{ method: "session.followUp", text: "first follow-up" }]);
			}).toPass();

			await input.fill("second follow-up");
			await pressPlatformShortcut(page, "Enter");
			await expect(input).toHaveValue("second follow-up");
			await page.keyboard.press("Alt+KeyQ");
			await expect
				.poll(() => submits)
				.toEqual([
					{ method: "session.followUp", text: "first follow-up" },
					{ method: "session.followUp", text: "second follow-up" },
				]);
		} finally {
			rmSync(session.path, { force: true });
		}
	});
});
