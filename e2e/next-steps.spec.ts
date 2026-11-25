import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { AssistantMessage } from "@thinkrail/contracts";
import {
	closeSettings,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	openSettingsSection,
	pressPlatformShortcut,
	revealWorkbenchTool,
	waitTerminalReady,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_960_000_000;
const SUGGESTIONS = ["Run the e2e suite", "Open a PR"];

interface ClientFrame {
	method?: string;
	params?: { text?: string };
}

async function observeClientFrames(page: Page, frames: ClientFrame[]): Promise<void> {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			const raw = typeof message === "string" ? message : message.toString();
			try {
				frames.push(JSON.parse(raw) as ClientFrame);
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => ws.send(message));
	});
}

function promptTexts(frames: ClientFrame[]): string[] {
	return frames.flatMap((frame) =>
		frame.method === "session.prompt" && frame.params?.text ? [frame.params.text] : [],
	);
}

type SeedMessage = Parameters<typeof seedWorkspaceSession>[1]["messages"][number];
const ANSWER = "Fixed: the debounce window now outlasts the poll interval.";

function seedSuggestedTurn(name: string, offset: number, answerBeforeCall = false): void {
	const ts = BASE_TS + offset;
	const answer = { type: "text" as const, text: ANSWER };
	const finalMessage: SeedMessage[] = answerBeforeCall
		? []
		: [{ role: "assistant", content: [answer], stopReason: "stop", timestamp: ts + 3_000 }];
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: "Fix the flaky watcher test.", timestamp: ts },
			{
				role: "assistant",
				content: [
					...(answerBeforeCall ? [answer] : []),
					{
						type: "toolCall",
						id: `suggest-${offset}`,
						name: "suggest_next_steps",
						arguments: { suggestions: SUGGESTIONS },
					},
				],
				stopReason: "toolUse",
				timestamp: ts + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: `suggest-${offset}`,
				toolName: "suggest_next_steps",
				content: [{ type: "text", text: "Saved. Now write your final message to the user." }],
				details: { suggestions: SUGGESTIONS },
				isError: false,
				timestamp: ts + 2_000,
			},
			...finalMessage,
		],
	});
}

function seedRefusedTurn(name: string, offset: number, retried: boolean): void {
	const ts = BASE_TS + offset;
	const call = (
		id: string,
		answer: AssistantMessage["content"][number],
		at: number,
	): SeedMessage => ({
		role: "assistant",
		content: [
			answer,
			{ type: "toolCall", id, name: "suggest_next_steps", arguments: { suggestions: SUGGESTIONS } },
		],
		stopReason: "toolUse",
		timestamp: at,
	});
	const result = (id: string, details: unknown, text: string, at: number): SeedMessage => ({
		role: "toolResult",
		toolCallId: id,
		toolName: "suggest_next_steps",
		content: [{ type: "text", text }],
		details,
		isError: false,
		timestamp: at,
	});
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: "Fix the flaky watcher test.", timestamp: ts },
			call(`refused-${offset}`, { type: "thinking", thinking: ANSWER }, ts + 1_000),
			result(
				`refused-${offset}`,
				{ suggestions: [], refused: true },
				"Your answer was not shown to the user.",
				ts + 2_000,
			),
			...(retried
				? [
						call(`retried-${offset}`, { type: "text", text: ANSWER }, ts + 3_000),
						result(
							`retried-${offset}`,
							{ suggestions: SUGGESTIONS },
							"Shown to the user as one-click next messages.",
							ts + 4_000,
						),
					]
				: []),
		],
	});
}

async function openSeededChat(
	page: Page,
	title: string,
	offset: number,
	answerBeforeCall = false,
): Promise<void> {
	await openFixtureProject(page);
	seedSuggestedTurn(title, offset, answerBeforeCall);
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
}

async function setNextSteps(page: Page, enabled: boolean): Promise<void> {
	await openSettingsSection(page, "extensions");
	const toggle = page.getByTestId("extension-toggle-next-steps");
	if ((await toggle.getAttribute("aria-checked")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
	await closeSettings(page);
}

test("a finished turn's suggestions show above the composer, survive a reload and send on click without touching the draft", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Suggested next steps", 0);

	const chips = page.getByTestId("composer-suggestion");
	await expect(chips.getByTestId("composer-suggestion-text")).toHaveText(SUGGESTIONS);
	await expect(chips.getByTestId("composer-suggestion-number")).toHaveText(["1", "2"]);
	await expect(chips.first()).toHaveAccessibleName(SUGGESTIONS[0] ?? "");
	await shot(page.getByTestId("chat-view"), "next-steps", "numbered-chips");
	await expect(page.getByTestId("chat-view")).toContainText("Suggested 2 next steps");

	await page.reload();
	await openPersistedChat(page, "Suggested next steps");
	await expect(chips.getByTestId("composer-suggestion-text")).toHaveText(SUGGESTIONS);
	await expect(page.getByTestId("turn-divider-status")).toHaveAttribute("data-outcome", "done");
	const answer = page
		.locator('[data-testid="chat-message"][data-role="assistant"]')
		.filter({ hasText: "Fixed: the debounce window" });
	await expect(answer.getByTestId("chat-copy")).toHaveCount(1);

	const input = page.getByTestId("chat-input");
	await input.fill("half-written draft");
	await chips.filter({ hasText: "Open a PR" }).click();
	await expect.poll(() => promptTexts(frames)).toEqual(["Open a PR"]);
	await expect(input).toHaveValue("half-written draft");
	await expect(page.getByTestId("composer-suggestions")).toHaveCount(0);
	await expect(input).toBeFocused();
});

test("a turn recorded when the call came after the answer still shows its chips and the answer's copy action", async ({
	page,
}) => {
	await openSeededChat(page, "Answer before the call", 5_000, true);
	await expect(
		page.getByTestId("composer-suggestion").getByTestId("composer-suggestion-text"),
	).toHaveText(SUGGESTIONS);
	await expect(page.getByTestId("turn-divider-status")).toHaveAttribute("data-outcome", "done");
	const answer = page
		.locator('[data-testid="chat-message"][data-role="assistant"]')
		.filter({ hasText: "Fixed: the debounce window" });
	await expect(answer.getByTestId("chat-copy")).toHaveCount(1);
});

test("Alt+N sends chip N from the input", async ({ page }) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Keyboard next steps", 10_000);
	await expect(page.getByTestId("composer-suggestion")).toHaveCount(2);

	const input = page.getByTestId("chat-input");
	await input.focus();
	await page.keyboard.press("Alt+Digit2");
	await expect.poll(() => promptTexts(frames)).toEqual(["Open a PR"]);
	await expect(input).toHaveValue("");
});

test("Alt+N does nothing inside a dialog, then sends from the Files tree, where focus stays", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Files tree next steps", 50_000);
	const chips = page.getByTestId("composer-suggestion");
	await expect(chips).toHaveCount(2);

	await openSettingsSection(page, "extensions");
	await page.keyboard.press("Alt+Digit1");
	await closeSettings(page);
	await expect(chips).toHaveCount(2);

	await pressPlatformShortcut(page, "Shift+E");
	const row = page.locator('[data-testid="file-node"]:focus');
	await expect(row).toHaveCount(1);
	const item = await row.getAttribute("data-tree-item");
	expect(item).toBeTruthy();
	const focused = page.locator(`[data-testid="file-node"][data-tree-item="${item}"]`);
	await expect(focused).toBeFocused();
	await page.keyboard.press("Alt+Digit2");
	await expect.poll(() => promptTexts(frames)).toEqual(["Open a PR"]);
	await expect(chips).toHaveCount(0);
	await expect(focused).toBeFocused();
	await expect(page.getByTestId("chat-input")).toHaveValue("");
});

test("Shift+Alt+N from a workbench tab puts chip N in the input; the terminal keeps Alt+N", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	const title = "Tab strip next steps";
	await openSeededChat(page, title, 60_000);
	const chips = page.getByTestId("composer-suggestion");
	const input = page.getByTestId("chat-input");
	await expect(chips).toHaveCount(2);

	const chatTab = page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.filter({ hasText: title })
		.getByRole("tab");
	await chatTab.focus();
	await page.keyboard.press("Alt+Shift+Digit2");
	await expect(input).toHaveValue("Open a PR");
	await expect(input).toBeFocused();
	await input.fill("");

	await page.keyboard.press("Control+Backquote");
	await waitTerminalReady(page);
	await expect
		.poll(() => page.evaluate(() => document.activeElement?.closest(".xterm") != null))
		.toBe(true);
	await page.keyboard.press("Alt+Digit1");
	await expect(chips).toHaveCount(2);

	await chatTab.focus();
	await page.keyboard.press("Alt+Digit1");
	await expect.poll(() => promptTexts(frames)).toEqual(["Run the e2e suite"]);
	await expect(chatTab).toBeFocused();
});

test("the code editor keeps Alt+N; a file tab in another group sends the main area's chat chip", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Editor next steps", 70_000);
	const chips = page.getByTestId("composer-suggestion");
	await expect(chips).toHaveCount(2);

	await revealWorkbenchTool(page, "files");
	await page
		.getByRole("tree", { name: "Files" })
		.getByTestId("file-node")
		.filter({ hasText: /^notes\.txt/ })
		.dblclick();
	const notes = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await expect(notes).toHaveAttribute("data-active", "true");
	await notes.getByRole("tab").focus();
	await pressPlatformShortcut(page, "Backslash");
	await expect(page.getByTestId("center-group")).toHaveCount(2);
	await expect(chips).toHaveCount(2);

	const editor = page.locator(".monaco-editor").first();
	await editor.locator(".view-lines").click();
	await expect
		.poll(() => page.evaluate(() => document.activeElement?.closest(".monaco-editor") != null))
		.toBe(true);
	await page.keyboard.press("Alt+Digit1");
	await expect(chips).toHaveCount(2);

	await notes.getByRole("tab").focus();
	await page.keyboard.press("Alt+Digit2");
	await expect.poll(() => promptTexts(frames)).toEqual(["Open a PR"]);
	await expect(notes.getByRole("tab")).toBeFocused();
});

test("Alt+N also sends from the conversation, the input's other local scope", async ({ page }) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Transcript next steps", 30_000);
	await expect(page.getByTestId("composer-suggestion")).toHaveCount(2);

	await page.getByTestId("chat-input").focus();
	await pressPlatformShortcut(page, "ArrowUp");
	await expect
		.poll(() =>
			page.evaluate(() => document.activeElement?.closest("[data-transcript-feed]") !== null),
		)
		.toBe(true);
	await page.keyboard.press("Alt+Digit1");
	await expect.poll(() => promptTexts(frames)).toEqual(["Run the e2e suite"]);
});

test("Shift+click and Shift+Alt+N put a suggestion in the input instead of sending it", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Edited next steps", 40_000);
	const input = page.getByTestId("chat-input");

	await input.fill("half-written draft");
	await page
		.getByTestId("composer-suggestion")
		.filter({ hasText: "Open a PR" })
		.click({
			modifiers: ["Shift"],
		});
	await expect(input).toHaveValue("half-written draft Open a PR");
	await expect(input).toBeFocused();

	await input.fill("");
	await page.keyboard.press("Alt+Shift+Digit1");
	await expect(input).toHaveValue("Run the e2e suite");
	await expect(page.getByTestId("composer-suggestion")).toHaveCount(2);
	expect(promptTexts(frames)).toEqual([]);
});

test("switching the extension off hides the chips while the transcript row stays", async ({
	page,
}) => {
	await openSeededChat(page, "Switched-off next steps", 20_000);
	await expect(page.getByTestId("composer-suggestion")).toHaveCount(2);
	try {
		await setNextSteps(page, false);
		await expect(page.getByTestId("composer-suggestions")).toHaveCount(0);
		await expect(page.getByTestId("chat-view")).toContainText("Suggested 2 next steps");
	} finally {
		await setNextSteps(page, true);
	}
	await expect(page.getByTestId("composer-suggestion")).toHaveCount(2);
});

async function openRefusedChat(page: Page, title: string, offset: number, retried: boolean) {
	await openFixtureProject(page);
	seedRefusedTurn(title, offset, retried);
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
	const activity = page.getByTestId("activity-group").first();
	await activity.getByTestId("activity-group-toggle").click();
	await activity.getByTestId("thinking-group").first().getByTestId("thinking-group-toggle").click();
	return activity.locator('[data-testid="activity-step"][data-tool="suggest_next_steps"]').first();
}

test("a call refused for a missing answer offers no chips and reads as a request for the answer", async ({
	page,
}) => {
	const row = await openRefusedChat(page, "Refused next steps", 80_000, false);
	await expect(row).toContainText("Asked for the answer as text first");
	await expect(page.getByTestId("composer-suggestions")).toHaveCount(0);
});

test("after a refused call, the retried call's chips show", async ({ page }) => {
	const row = await openRefusedChat(page, "Retried next steps", 90_000, true);
	await expect(row).toContainText("Asked for the answer as text first");
	await expect(page.getByTestId("composer-suggestion-text")).toHaveText(SUGGESTIONS);
	await shot(page.getByTestId("chat-view"), "next-steps", "refused-then-retried");
});
