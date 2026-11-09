import { expect, type Locator, type Page, test } from "@playwright/test";
import { openFixtureProject, openWorkspaceChat, revealWorkbenchTool } from "./fixtures/app";

const KEYCODES = { Enter: 13, Escape: 27 } as const;
const IME_SENTINEL_KEYCODE = 229;

type Key = keyof typeof KEYCODES;
type KeyState = { isComposing: boolean; keyCode: number };

const composing = (key: Key): KeyState => ({ isComposing: true, keyCode: KEYCODES[key] });
const sentinel: KeyState = { isComposing: false, keyCode: IME_SENTINEL_KEYCODE };
const ordinary = (key: Key): KeyState => ({ isComposing: false, keyCode: KEYCODES[key] });
const imeOwned = (key: Key): KeyState[] => [composing(key), sentinel];

interface ClientFrame {
	method?: string;
	params?: { text?: unknown };
}

function capturePromptTexts(page: Page): string[] {
	const prompts: string[] = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			try {
				const frame = JSON.parse(
					typeof payload === "string" ? payload : payload.toString(),
				) as ClientFrame;
				if (frame.method === "session.prompt" && typeof frame.params?.text === "string") {
					prompts.push(frame.params.text);
				}
			} catch {}
		});
	});
	return prompts;
}

async function dispatchKey(
	input: Locator,
	key: Key,
	state: KeyState,
): Promise<{ defaultPrevented: boolean; isComposing: boolean; keyCode: number }> {
	return input.evaluate(
		(element, keyboard) => {
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				code: keyboard.key,
				isComposing: keyboard.isComposing,
				key: keyboard.key,
			});
			Object.defineProperty(event, "keyCode", { value: keyboard.keyCode });
			element.dispatchEvent(event);
			return {
				defaultPrevented: event.defaultPrevented,
				isComposing: event.isComposing,
				keyCode: event.keyCode,
			};
		},
		{ key, ...state },
	);
}

test("composer yields IME Enter events before applying send shortcuts", async ({ page }) => {
	const sentPromptTexts = capturePromptTexts(page);
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	const userMessages = page.locator('[data-testid="chat-message"][data-role="user"]');
	await input.fill("ni hao ma");

	for (const state of imeOwned("Enter")) {
		expect(await dispatchKey(input, "Enter", state)).toEqual({ defaultPrevented: false, ...state });
		await expect(input).toHaveValue("ni hao ma");
		await expect(userMessages).toHaveCount(0);
	}

	await input.fill("你好吗");
	expect(await dispatchKey(input, "Enter", ordinary("Enter"))).toEqual({
		defaultPrevented: true,
		...ordinary("Enter"),
	});
	await expect(input).toHaveValue("");
	await expect.poll(() => sentPromptTexts).toEqual(["你好吗"]);
});

test("the TODO add field adds a step only on an ordinary Enter", async ({ page }) => {
	await openWorkspaceChat(page);
	await revealWorkbenchTool(page, "plan");
	const rail = page.getByTestId("plan-rail-pane");
	const input = rail.getByTestId("todo-add-input");
	const rows = rail.getByTestId("todo-row");

	await input.fill("nihao");
	for (const state of imeOwned("Enter")) {
		await dispatchKey(input, "Enter", state);
		await expect(input).toHaveValue("nihao");
	}

	await input.fill("你好");
	await dispatchKey(input, "Enter", ordinary("Enter"));
	await expect(rows.filter({ hasText: "你好" })).toBeVisible();
	await expect(rows).toHaveCount(1);
	await expect(input).toHaveValue("");
});

test("a chat tab rename survives IME Enter and Escape and commits on an ordinary Enter", async ({
	page,
}) => {
	await openWorkspaceChat(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Rename chat", exact: true }).click();
	const input = chatTab.getByTestId("chat-tab-name-input");
	await expect(input).toBeFocused();

	await input.fill("nihao");
	for (const key of ["Escape", "Enter"] as const) {
		for (const state of imeOwned(key)) {
			await dispatchKey(input, key, state);
			await expect(input).toBeFocused();
			await expect(input).toHaveValue("nihao");
		}
	}

	await input.fill("你好");
	await dispatchKey(input, "Enter", ordinary("Enter"));
	await expect(input).toHaveCount(0);
	await expect(chatTab).toContainText("你好");
});

test("the Create workspace dialog stays open on an IME Escape and closes on an ordinary one", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("welcome-title").click();
	await page.keyboard.press("ControlOrMeta+n");
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	const prompt = dialog.getByTestId("ws-prompt");
	await expect(prompt).toBeFocused();

	await prompt.fill("nihao");
	for (const state of imeOwned("Escape")) {
		await dispatchKey(prompt, "Escape", state);
		await expect(dialog).toBeVisible();
		await expect(prompt).toHaveValue("nihao");
	}

	await dispatchKey(prompt, "Escape", ordinary("Escape"));
	await expect(dialog).toBeHidden();
});
