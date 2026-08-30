import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	openTerminal,
	openWorkspaceChat,
	visibleTerminal,
	visibleTerminalScreen,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedExternalCwdSessions, seedWorkspaceSession } from "./fixtures/sessions";

type SeededMessages = Parameters<typeof seedWorkspaceSession>[1]["messages"];

async function openSeededClosedChat(page: Page, messages: SeededMessages) {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("start-chat").first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), { messages });

	await page.getByTestId("project-item").first().click();
	await defaultWorkspaceRow(page).click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const history = page.getByTestId("chat-history").first();
	await expect(history).toBeVisible();
	await history.click();
	const closedChat = page.getByTestId("closed-chat-item").first();
	await expect(closedChat).toBeVisible();
	await closedChat.click();

	const latestUserMessage = messages.filter((message) => message.role === "user").at(-1);
	if (latestUserMessage) {
		await expect(
			page
				.locator('[data-testid="chat-message"][data-role="user"]')
				.filter({ hasText: latestUserMessage.text }),
		).toBeVisible({ timeout: 20_000 });
	}
	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();
	return input;
}

async function settleSubmittedTurn(page: Page): Promise<void> {
	const abort = page.getByTestId("chat-abort");
	const settled = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" })
		.last()
		.or(page.locator('[data-testid="chat-message"][data-role="error"]').last());
	await expect(abort.or(settled).first()).toBeVisible({ timeout: 20_000 });
	if (await abort.isVisible()) await abort.click();
	await expect(settled).toBeVisible({ timeout: 20_000 });
}

async function revealUserTurn(page: Page, text: string) {
	await page.getByTestId("virtuoso-scroller").evaluate((element) => {
		element.scrollTop = 0;
	});
	const turn = page
		.locator('[data-testid="chat-message"][data-role="user"]')
		.filter({ hasText: text });
	await expect(turn).toBeVisible();
	return turn;
}

test("Ctrl+R opens history recall, cycles scope to all, zooms to messages, inserts a prompt, and Esc preserves the draft", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	seedExternalCwdSessions();

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");
	const promptItems = page.locator('[data-testid="history-item"][data-kind="prompt"]');
	const messageItems = page.locator('[data-testid="history-item"][data-kind="message"]');

	await input.press("Control+r");
	await expect(overlay).toBeVisible();
	await expect(overlay).toHaveAttribute("data-stage", "compact");
	await expect(query).toBeFocused();
	await expect(scopeBadge).toHaveAttribute("data-scope", "workspace");

	await query.fill("fix");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "all");
	await expect(scopeBadge).toContainText("All");
	await expect(promptItems.filter({ hasText: "fix the flaky watcher test" })).toBeVisible();
	await expect(page.getByTestId("history-counts")).toHaveText("1/1");

	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	const debounceHit = messageItems.filter({ hasText: "debounce window overlaps" });
	await expect(debounceHit).toBeVisible();
	await expect(debounceHit).toContainText("not a ThinkRail workspace");
	await expect(page.getByTestId("history-counts").last()).toHaveText("1/1");

	await query.press("ArrowDown");
	await query.press("Enter");
	await expect(overlay).toBeVisible();
	await expect(input).toHaveValue("");

	await query.press("ArrowUp");
	await query.press("Enter");
	await expect(overlay).toBeHidden();
	await expect(input).toHaveValue("fix the flaky watcher test");
	await expect(input).toBeFocused();

	await input.fill("my draft");
	await input.press("Control+r");
	await expect(overlay).toBeVisible();
	await expect(query).toHaveValue("my draft");
	await query.fill("nothing matches this");
	await query.press("Escape");
	await expect(overlay).toBeHidden();
	await expect(input).toHaveValue("my draft");

	await input.press("Control+r");
	await query.fill("fix");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "all");
	await expect(promptItems.filter({ hasText: "fix the flaky watcher test" })).toBeVisible();
	await query.press("ControlOrMeta+Enter");
	await expect(overlay).toBeHidden();
	await expect(input).toHaveValue("");
	await settleSubmittedTurn(page);
	await revealUserTurn(page, "fix the flaky watcher test");
});

test("Cmd/Ctrl+Enter from the overlay sends pending image attachments with the recalled prompt and clears them", async ({
	page,
}) => {
	const sentFrames: string[] = [];
	page.on("websocket", (ws) => {
		ws.on("framesent", (frame) => {
			sentFrames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString());
		});
	});

	await openWorkspaceChat(page);
	seedExternalCwdSessions();

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const query = page.getByTestId("history-query");
	const thumbnails = page.getByTestId("composer-images");

	await input.evaluate((el) => {
		const dt = new DataTransfer();
		dt.items.add(
			new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "pixel.png", { type: "image/png" }),
		);
		el.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
		);
	});
	await expect(thumbnails).toBeVisible();
	await expect(thumbnails).toContainText("pixel.png");

	await input.press("Control+r");
	await query.fill("fix");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(
		page
			.locator('[data-testid="history-item"][data-kind="prompt"]')
			.filter({ hasText: "fix the flaky watcher test" }),
	).toBeVisible();
	await query.press("ControlOrMeta+Enter");
	await expect(overlay).toBeHidden();

	await expect(input).toHaveValue("");
	await expect(thumbnails).toBeHidden();

	await expect(() => {
		const prompt = sentFrames.find(
			(f) => f.includes('"session.prompt"') && f.includes("fix the flaky watcher test"),
		);
		expect(prompt).toBeDefined();
		expect(prompt).toContain('"images"');
		expect(prompt).toContain('"image/png"');
	}).toPass({ timeout: 5000 });
	await settleSubmittedTurn(page);
	const sentTurn = await revealUserTurn(page, "fix the flaky watcher test");
	await expect(sentTurn.getByTestId("chat-attachment-chip")).toContainText("pixel.png");
});

test("empty query in chat scope shows the empty state for a session with no history yet", async ({
	page,
}) => {
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");

	await input.press("Control+r");
	await expect(overlay).toBeVisible();

	await query.press("Control+r");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "chat");

	await expect(overlay).toContainText("no matches");
});

test("Ctrl+R dismisses an open mention menu instead of overlapping it", async ({ page }) => {
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const mentionMenu = page.getByTestId("mention-menu");

	await input.fill("@");
	await expect(mentionMenu).toBeVisible();

	await input.press("Control+r");
	await expect(overlay).toBeVisible();
	await expect(mentionMenu).not.toBeVisible();
});

test("plain ArrowUp/ArrowDown recall steps through this chat's own prior prompts, a diverging edit exits the session, and the history button opens the overlay", async ({
	page,
}) => {
	const input = await openSeededClosedChat(page, [
		{ role: "user", text: "audit the retry backoff", timestamp: 1_700_400_000_000 },
		{ role: "assistant", text: "Audited it — looks fine.", timestamp: 1_700_400_001_000 },
		{
			role: "user",
			text: "add a jittered ceiling to the backoff",
			timestamp: 1_700_400_002_000,
		},
		{ role: "assistant", text: "Added the ceiling.", timestamp: 1_700_400_003_000 },
		{ role: "user", text: "write a test for the jitter", timestamp: 1_700_400_004_000 },
		{ role: "assistant", text: "Added a test.", timestamp: 1_700_400_005_000 },
	]);
	await expect(input).toHaveValue("");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("write a test for the jitter");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("add a jittered ceiling to the backoff");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("audit the retry backoff");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("audit the retry backoff");

	await input.press("ArrowDown");
	await expect(input).toHaveValue("add a jittered ceiling to the backoff");
	await input.press("ArrowDown");
	await expect(input).toHaveValue("write a test for the jitter");
	await input.press("ArrowDown");
	await expect(input).toHaveValue("");

	await input.press("ArrowUp");
	await expect(input).toHaveValue("write a test for the jitter");
	await input.press("End");
	await input.press("!");
	await expect(input).toHaveValue("write a test for the jitter!");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("write a test for the jitter!");

	await page.getByTestId("history-open").click();
	await expect(page.getByTestId("history-overlay")).toBeVisible();
});

test("a recall step immediately followed by a full-value replace never doubles the value, even under CPU contention", async ({
	page,
}) => {
	test.setTimeout(60_000);
	const input = await openSeededClosedChat(page, [
		{ role: "user", text: "write a test for the jitter", timestamp: 1_700_500_000_000 },
		{ role: "assistant", text: "Added a test.", timestamp: 1_700_500_001_000 },
	]);
	await expect(input).toHaveValue("");

	const client = await page.context().newCDPSession(page);
	await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

	for (let i = 0; i < 200; i++) {
		await input.press("ArrowUp");
		await expect(input).toHaveValue("write a test for the jitter");
		const replacement = `edit ${i}`;
		await input.fill(replacement);
		expect(await input.inputValue()).toBe(replacement);
		await input.fill("");
	}
});

test("a prompt repeated earlier in the chat recalls at its most recent position, deduped to one entry", async ({
	page,
}) => {
	const input = await openSeededClosedChat(page, [
		{ role: "user", text: "alpha", timestamp: 1_700_450_000_000 },
		{ role: "assistant", text: "ok", timestamp: 1_700_450_001_000 },
		{ role: "user", text: "beta", timestamp: 1_700_450_002_000 },
		{ role: "assistant", text: "ok", timestamp: 1_700_450_003_000 },
		{ role: "user", text: "alpha", timestamp: 1_700_450_004_000 },
		{ role: "assistant", text: "ok", timestamp: 1_700_450_005_000 },
	]);
	await expect(input).toHaveValue("");

	await input.press("ArrowUp");
	await expect(input).toHaveValue("alpha");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("beta");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("beta");
});

test("the history overlay stays inside the viewport and its query stays focusable at a narrow (~390px) width", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	await page.setViewportSize({ width: 390, height: 844 });

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	await input.press("Control+r");
	await expect(overlay).toBeVisible();

	const viewportSize = page.viewportSize();
	const box = await overlay.boundingBox();
	expect(box).not.toBeNull();
	expect(viewportSize).not.toBeNull();
	if (box && viewportSize) {
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewportSize.width);
	}

	const query = page.getByTestId("history-query");
	await expect(query).toBeVisible();
	await expect(query).toBeFocused();
});

test("ArrowDown repeatedly scrolls the keyboard-selected row into view inside the results container", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspace.worktreePath, {
		messages: Array.from({ length: 30 }, (_, i) => ({
			role: "user" as const,
			text: `prompt number ${String(i).padStart(2, "0")}`,
			timestamp: 1_700_600_000_000 + i * 1_000,
		})),
	});
	await page.waitForTimeout(2_100);

	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	await expect(page.locator('[data-testid="history-item"][data-kind="prompt"]')).toHaveCount(30);

	const query = page.getByTestId("history-query");
	const results = page.getByTestId("history-results");
	const selectedRow = page.locator('[data-testid="history-item"][data-selected="true"]');

	for (let i = 0; i < 25; i++) {
		await query.press("ArrowDown");
	}
	await expect(selectedRow).toHaveCount(1);

	const resultsBox = await results.boundingBox();
	const rowBox = await selectedRow.boundingBox();
	expect(resultsBox).not.toBeNull();
	expect(rowBox).not.toBeNull();
	if (resultsBox && rowBox) {
		expect(rowBox.y).toBeGreaterThanOrEqual(resultsBox.y - 1);
		expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(resultsBox.y + resultsBox.height + 1);
	}
});

test("the zoomed stage's preview pane shows the selected item's full text, including a tail truncated in its row, and updates on ArrowDown; the compact stage has no preview at all", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const longPrompt = [
		"Investigate the deployment pipeline failure end to end before the next release window opens.",
		"Check the retry policy, the queue backlog depth, and every healthcheck threshold across all services.",
		"Root cause found: the zephyr9000 rollback trigger misfired under load and needs a guard added.",
	].join("\n");
	expect(longPrompt.length).toBeGreaterThan(200);
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{ role: "user", text: longPrompt, timestamp: 1_700_900_000_000 },
			{ role: "user", text: "a shorter unrelated prompt", timestamp: 1_700_900_001_000 },
		],
	});
	await page.waitForTimeout(2_100);

	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	const preview = page.getByTestId("history-preview");

	await expect(preview).toHaveCount(0);

	await query.fill("zephyr9000");
	const longRow = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "Investigate the deployment pipeline" });
	await expect(longRow).toBeVisible();
	await expect(longRow).not.toContainText("zephyr9000");

	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	await expect(preview).toBeVisible();
	await expect(preview).toContainText("zephyr9000");
	await expect(preview).toContainText("Investigate the deployment pipeline failure");

	await query.fill("");
	await expect(page.locator('[data-testid="history-item"][data-kind="prompt"]')).toHaveCount(2);
	await expect(preview).toContainText("a shorter unrelated prompt");
	await expect(preview).not.toContainText("zephyr9000");

	await query.press("ArrowDown");
	await expect(preview).toContainText("zephyr9000");
	await expect(preview).toContainText("Investigate the deployment pipeline failure");
});

test("at a narrow (~390px) viewport, the zoomed stage's preview pane stacks below the results list, both visible", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{
				role: "user",
				text: "a narrow-viewport preview stacking test prompt",
				timestamp: 1_701_000_000_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	const results = page.getByTestId("history-results");
	const preview = page.getByTestId("history-preview");
	await expect(results).toBeVisible();
	await expect(preview).toBeVisible();

	const resultsBox = await results.boundingBox();
	const previewBox = await preview.boundingBox();
	expect(resultsBox).not.toBeNull();
	expect(previewBox).not.toBeNull();
	if (resultsBox && previewBox) {
		expect(previewBox.y).toBeGreaterThanOrEqual(resultsBox.y + resultsBox.height - 1);
	}
});

test("the scope badge opens a picker that selects a scope directly without disturbing the results selection, returns focus to the query input, and Ctrl+R still cycles afterward", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspace.worktreePath, {
		messages: [
			{
				role: "user",
				text: "alpha prompt for the scope picker test",
				timestamp: 1_701_100_000_000,
			},
			{ role: "user", text: "beta prompt for the scope picker test", timestamp: 1_701_100_001_000 },
		],
	});
	seedExternalCwdSessions();
	await page.waitForTimeout(2_100);

	const input = page.getByTestId("chat-input");
	await expect(input).toBeVisible();

	await input.press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");
	const scopeOptions = page.getByTestId("history-scope-option");
	const selectedRow = page.locator('[data-testid="history-item"][data-selected="true"]');

	await expect(page.locator('[data-testid="history-item"][data-kind="prompt"]')).toHaveCount(2);
	await expect(selectedRow).toContainText("beta prompt for the scope picker test");

	await scopeBadge.click();
	await expect(scopeOptions).toHaveCount(4);
	await expect(scopeOptions.nth(0)).toHaveAttribute("data-scope", "chat");
	await expect(scopeOptions.nth(1)).toHaveAttribute("data-scope", "workspace");
	await expect(scopeOptions.nth(2)).toHaveAttribute("data-scope", "project");
	await expect(scopeOptions.nth(3)).toHaveAttribute("data-scope", "all");

	await page.keyboard.press("ArrowDown");
	await expect(selectedRow).toContainText("beta prompt for the scope picker test");

	await scopeOptions.filter({ hasText: "Everywhere" }).click();
	await expect(scopeBadge).toHaveAttribute("data-scope", "all");
	await expect(query).toBeFocused();
	await expect(
		page
			.locator('[data-testid="history-item"][data-kind="prompt"]')
			.filter({ hasText: "deploy the docs site" }),
	).toBeVisible();

	await query.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "chat");
});

test("Ctrl+R and Escape are owned app-wide: both work with focus outside the composer", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	seedExternalCwdSessions();

	const input = page.getByTestId("chat-input");
	const overlay = page.getByTestId("history-overlay");
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");
	const outside = page.getByTestId("scope-context");

	await outside.click();
	await page.keyboard.press("Control+r");
	await expect(overlay).toBeVisible();
	await expect(query).toBeFocused();

	await input.click();
	await page.keyboard.press("Escape");
	await expect(overlay).toBeHidden();

	await page.keyboard.press("Control+r");
	await expect(overlay).toBeVisible();
	await outside.click();
	await page.keyboard.press("Escape");
	await expect(overlay).toBeHidden();
	await expect(input).toBeFocused();
	await page.keyboard.type("still typing");
	await expect(input).toHaveValue("still typing");

	await input.click();
	await page.keyboard.press("Home");
	await page.keyboard.press("Control+r");
	await expect(overlay).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(input).toBeFocused();
	await page.keyboard.type("i am ");
	await expect(input).toHaveValue("i am still typing");
	await input.fill("");

	await page.keyboard.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "workspace");
	await outside.click();
	await page.keyboard.press("Control+r");
	await expect(scopeBadge).toHaveAttribute("data-scope", "project");

	await scopeBadge.click();
	await expect(page.getByTestId("history-scope-option")).toHaveCount(4);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("history-scope-option")).toHaveCount(0);
	await expect(overlay).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(overlay).toBeHidden();
});

test("Ctrl+R inside a terminal belongs to the shell, not to history search", async ({ page }) => {
	await openWorkspaceChat(page);
	seedExternalCwdSessions();

	await openTerminal(page);
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.press("Control+r");

	await expect(page.getByTestId("history-overlay")).toBeHidden();
	await expect(visibleTerminalScreen(page)).toContainText(/i-search|\^R/i);
});

test("Ctrl+R from an active file tab switches to the chat and opens history search", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	seedExternalCwdSessions();

	await page.getByTestId("tab-files").click();
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();
	await readme.dblclick();
	const fileTab = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	await expect(fileTab).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("chat-input")).toHaveCount(0);

	await page.getByTestId("editor-pane").click();
	await page.keyboard.press("Control+r");

	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveAttribute(
		"data-active",
		"false",
	);
	await expect(page.getByTestId("history-overlay")).toBeVisible();
	await expect(page.getByTestId("history-query")).toBeFocused();
});

test("the Ctrl+R and Ctrl+S chords fire on a non-Latin keyboard layout", async ({ page }) => {
	await openWorkspaceChat(page);
	seedExternalCwdSessions();

	const overlay = page.getByTestId("history-overlay");
	const query = page.getByTestId("history-query");
	const scopeBadge = page.getByTestId("history-scope");
	const promptRow = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "fix the flaky watcher test" });

	const cdp = await page.context().newCDPSession(page);
	const pressCyrillicChord = async (key: string, code: string, virtualKeyCode: number) => {
		for (const type of ["keyDown", "keyUp"] as const) {
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				modifiers: 2,
				windowsVirtualKeyCode: virtualKeyCode,
			});
		}
	};
	const pressCtrlR = () => pressCyrillicChord("к", "KeyR", 82);

	await page.getByTestId("chat-input").click();
	await pressCtrlR();
	await expect(overlay).toBeVisible();

	await query.fill("flaky");
	await pressCtrlR();
	await pressCtrlR();
	await expect(scopeBadge).toHaveAttribute("data-scope", "all");
	await expect(promptRow).toBeVisible();

	await pressCyrillicChord("ы", "KeyS", 83);
	await expect(overlay).toBeHidden();
	await expect(page.getByTestId("template-editor-dialog")).toBeVisible();
	await expect(page.getByTestId("template-body-input")).toHaveValue("fix the flaky watcher test");

	await page.getByTestId("template-cancel").click();
});
