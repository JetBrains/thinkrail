import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
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

function seedSuggestedTurn(name: string, offset: number): void {
	const ts = BASE_TS + offset;
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: "Fix the flaky watcher test.", timestamp: ts },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Fixed: the debounce window now outlasts the poll interval." },
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
				content: [{ type: "text", text: "Shown to the user as one-click next messages." }],
				details: { suggestions: SUGGESTIONS },
				isError: false,
				timestamp: ts + 2_000,
			},
		],
	});
}

async function openSeededChat(page: Page, title: string, offset: number): Promise<void> {
	await openFixtureProject(page);
	seedSuggestedTurn(title, offset);
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
}

async function setNextSteps(page: Page, enabled: boolean): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-extensions").click();
	const toggle = page.getByTestId("extension-toggle-next-steps");
	if ((await toggle.getAttribute("aria-checked")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

test("a finished turn's suggestions show above the composer, survive a reload and send on click without touching the draft", async ({
	page,
}) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Suggested next steps", 0);

	const chips = page.getByTestId("composer-suggestion");
	await expect(chips).toHaveText(SUGGESTIONS);
	await expect(page.getByTestId("chat-view")).toContainText("Suggested 2 next steps");

	await page.reload();
	await openPersistedChat(page, "Suggested next steps");
	await expect(chips).toHaveText(SUGGESTIONS);

	const input = page.getByTestId("chat-input");
	await input.fill("half-written draft");
	await chips.filter({ hasText: "Open a PR" }).click();
	await expect.poll(() => promptTexts(frames)).toEqual(["Open a PR"]);
	await expect(input).toHaveValue("half-written draft");
	await expect(page.getByTestId("composer-suggestions")).toHaveCount(0);
});

test("Alt+N sends chip N only while focus is inside the chat", async ({ page }) => {
	const frames: ClientFrame[] = [];
	await observeClientFrames(page, frames);
	await openSeededChat(page, "Keyboard next steps", 10_000);
	await expect(page.getByTestId("composer-suggestion")).toHaveCount(2);

	await page.getByTestId("open-settings").focus();
	await page.keyboard.press("Alt+Digit1");
	await expect(page.getByTestId("composer-suggestion")).toHaveCount(2);
	expect(promptTexts(frames)).toEqual([]);

	const input = page.getByTestId("chat-input");
	await input.focus();
	await page.keyboard.press("Alt+Digit2");
	await expect.poll(() => promptTexts(frames)).toEqual(["Open a PR"]);
	await expect(input).toHaveValue("");
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
