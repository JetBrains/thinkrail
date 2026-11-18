import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import type { SessionState, SessionStateRecord } from "@thinkrail/contracts";
import type { AskUserQuestionArgs } from "@thinkrail/pi-ask-user-question/core";
import {
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openPersistedChat,
	openSettingsSection,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";
import {
	openPersistedChatAfterInput,
	type QuestionnaireArgs,
	seedQuestionnaire,
} from "./fixtures/ask";
import { waitForScrollStability } from "./fixtures/chatScroll";
import { resetKeybindings, setKeybindings } from "./fixtures/keybindings";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { E2eWire } from "./fixtures/wire";

const BASE_TS = 1_700_880_000_000;
const MOCKUPS = ".thinkrail/context/mockups";

const ROLLOUT = {
	question: "Which rollout should the keys use?",
	header: "Rollout",
	options: [
		{ label: "Rollout alpha", description: "Use the first fixture choice." },
		{ label: "Rollout beta", description: "Use the second fixture choice." },
		{ label: "Rollout gamma", description: "Use the third fixture choice." },
	],
} satisfies AskUserQuestionArgs["questions"][number];

const ROUND = {
	questions: [
		ROLLOUT,
		{
			question: "Which checks should the keys run?",
			header: "Checks",
			multiSelect: true,
			options: [
				{ label: "Checks lint", description: "Run the linter." },
				{ label: "Checks types", description: "Run the type checker." },
			],
		},
	],
} satisfies AskUserQuestionArgs;

const PREVIEWED = {
	questions: [
		{
			question: "Which rebinding dialog should ship?",
			header: "Dialog",
			options: [
				{
					label: "Recorder dialog",
					description: "A field that records the chord.",
					previewFile: `${MOCKUPS}/recorder.html`,
				},
				{
					label: "Inline editor",
					description: "Edit the chord in the row.",
					preview: "## Inline\n\nThe chord is edited in place.",
				},
				{ label: "No dialog", description: "Keep the JSON file." },
			],
		},
	],
} satisfies AskUserQuestionArgs;

const TALL_COUNT = 9;

const TALL = {
	questions: [
		{
			question: "Which rollout should the long list use?",
			header: "Long list",
			options: Array.from({ length: TALL_COUNT }, (_, i) => ({
				label: `Long choice ${i + 1}`,
				description: `A longer description for choice ${i + 1} so the row takes two lines of text in the dock.`,
			})),
		},
	],
} satisfies AskUserQuestionArgs;

const LONG_PROMPT = Array.from(
	{ length: 30 },
	(_, i) => `Line ${i + 1} of a long request, so the transcript above the dock scrolls.`,
).join("\n\n");

const RECORDER = `<!doctype html><html><body><main><h1>Rebind “Focus composer”</h1><input aria-label="Shortcut" placeholder="Press a shortcut…"><button>Save</button></main></body></html>`;

const activeAsk = (page: Page) =>
	page.getByTestId("chat-dock").locator('[data-testid="ask-user-question"][data-tone="active"]');
const composer = (page: Page) => page.getByTestId("chat-input");
const chromium = () => test.info().project.name === "chromium";

async function openRound(
	page: Page,
	name: string,
	args: QuestionnaireArgs,
): Promise<{ card: Locator; path: string; id: string }> {
	await openFixtureProject(page);
	const session = seedQuestionnaire(name, `ask-keys-${name.replaceAll(" ", "-")}`, args, BASE_TS);
	await enterDefaultWorkspace(page);
	await hideAuxiliaryWorkbench(page);
	await openPersistedChatAfterInput(page, name);
	const card = activeAsk(page);
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	return { card, ...session };
}

async function settleFrames(page: Page, frames = 6): Promise<void> {
	await page.evaluate(
		(count) =>
			new Promise<void>((resolve) => {
				const step = (left: number) =>
					left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
				step(count);
			}),
		frames,
	);
}

const scrollTopOf = (locator: Locator) => locator.evaluate((element) => element.scrollTop);

function focusShownIn(scroller: Locator): Promise<boolean> {
	return scroller.evaluate((element) => {
		const active = element.ownerDocument.activeElement;
		if (!active || !element.contains(active)) return false;
		const top = element.getBoundingClientRect().top + element.clientTop;
		const box = active.getBoundingClientRect();
		return box.top >= top - 0.5 && box.bottom <= top + element.clientHeight + 0.5;
	});
}

function isFocused(locator: Locator): Promise<boolean> {
	return locator.evaluate((element) => element === element.ownerDocument.activeElement);
}

async function blur(page: Page): Promise<void> {
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});
}

interface HeldQuestion {
	release(): void;
	waitOn(toolCallId: string): void;
}

const IDLE: SessionState = {
	execution: "idle",
	runId: null,
	needsInput: null,
	completion: null,
	completionUnread: false,
	queuedCount: 0,
	backgroundWork: false,
};

// Reports a held session idle until `release`, so its seeded question "arrives" on cue (e2e/SPEC.md).
async function routeSessionStates(page: Page) {
	let browser: WebSocketRoute | null = null;
	const held = new Set<string>();
	const idle = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(idle);
		if (value === null || typeof value !== "object") return value;
		const object = Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, idle(item)] as const),
		);
		const { sessionId, state } = object;
		return typeof sessionId === "string" &&
			held.has(sessionId) &&
			state !== null &&
			typeof state === "object" &&
			"needsInput" in state
			? { ...object, state: { ...state, needsInput: null } }
			: object;
	};
	await page.routeWebSocket(/\/ws(\?|$)/, (route) => {
		browser = route;
		const server = route.connectToServer();
		route.onMessage((message) => server.send(message));
		server.onMessage((message) => {
			if (held.size === 0) {
				route.send(message);
				return;
			}
			try {
				route.send(JSON.stringify(idle(JSON.parse(message.toString()))));
			} catch {
				route.send(message);
			}
		});
	});
	const send = (record: SessionStateRecord) => {
		if (!browser) throw new Error("the app has not connected yet");
		browser.send(JSON.stringify({ channel: "session.state", data: record }));
	};
	return {
		async hold(sessionId: string, toolCallId: string): Promise<HeldQuestion> {
			const wire = await E2eWire.connect(Number(new URL(page.url()).port));
			let record: SessionStateRecord;
			try {
				const [project] = await wire.request("project.list", {});
				if (!project) throw new Error("missing fixture project");
				const workspaces = await wire.request("workspace.list", { projectId: project.id });
				const workspace = workspaces.find((candidate) => candidate.kind === "default");
				if (!workspace) throw new Error("missing default workspace");
				record = { sessionId, workspaceId: workspace.id, projectId: project.id, state: IDLE };
			} finally {
				wire.close();
			}
			held.add(sessionId);
			send(record);
			const waiting = (id: string): SessionStateRecord => ({
				...record,
				state: {
					...IDLE,
					needsInput: {
						interactionId: `tool-response:${id}`,
						kind: "tool-response",
						toolCallId: id,
					},
				},
			});
			return {
				release() {
					held.delete(sessionId);
					send(waiting(toolCallId));
				},
				waitOn(id) {
					send(waiting(id));
				},
			};
		},
	};
}

async function openHeldRound(
	page: Page,
	name: string,
): Promise<{ held: HeldQuestion; path: string; card: Locator }> {
	const toolCallId = `ask-keys-${name.replaceAll(" ", "-")}`;
	const states = await routeSessionStates(page);
	await openFixtureProject(page);
	const session = seedQuestionnaire(name, toolCallId, { questions: [ROLLOUT] }, BASE_TS);
	await enterDefaultWorkspace(page);
	await hideAuxiliaryWorkbench(page);
	const held = await states.hold(session.id, toolCallId);
	await openPersistedChat(page, name);
	await expect(
		page.getByTestId("chat-scroll").locator('[data-testid="ask-user-question"]').first(),
	).toBeVisible();
	await expect(activeAsk(page)).toHaveCount(0);
	return { held, path: session.path, card: activeAsk(page) };
}

test("F6 and Mod+1 land on the waiting question's current option; Mod+L still goes to the composer", async ({
	page,
}) => {
	const { card, path } = await openRound(page, "landing round", { questions: [ROLLOUT] });
	try {
		const options = card.getByTestId("ask-option");
		await page.keyboard.press("ArrowDown");
		await expect(options.nth(1)).toBeFocused();
		await pressPlatformShortcut(page, "L");
		await expect(composer(page)).toBeFocused();

		await blur(page);
		await page.keyboard.press("F6");
		await expect(page.locator('[data-region-kind="topbar"]')).toHaveAttribute(
			"data-region-active",
			"",
		);
		await page.keyboard.press("F6");
		await expect(options.nth(1)).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveCount(0);
		if (chromium()) await shot(page.getByTestId("chat-view"), "ask-keyboard", "landing");

		await pressPlatformShortcut(page, "L");
		await expect(composer(page)).toBeFocused();
		await pressPlatformShortcut(page, "1");
		await expect(options.nth(1)).toBeFocused();
	} finally {
		rmSync(path, { force: true });
	}
});

test("Shift+Tab from the composer lands on the current option, and Esc returns to the composer with the question docked", async ({
	page,
}) => {
	const { card, path } = await openRound(page, "shift tab round", { questions: [ROLLOUT] });
	try {
		await pressPlatformShortcut(page, "L");
		await expect(composer(page)).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await expect(card.getByTestId("ask-skip")).not.toBeFocused();

		await page.keyboard.press("Escape");
		await expect(composer(page)).toBeFocused();
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute("data-collapsed", "false");
		await expect(card.getByTestId("ask-waiting")).toHaveText("waiting · F6 to answer");
	} finally {
		rmSync(path, { force: true });
	}
});

test("a click on Submit parks focus on the receipt without a ring; a keyboard submit returns to the composer", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await openFixtureProject(page);
	const clicked = seedQuestionnaire(
		"click answer",
		"ask-keys-click",
		{ questions: [ROLLOUT] },
		BASE_TS,
	);
	const typed = seedQuestionnaire(
		"keyboard answer",
		"ask-keys-keyboard",
		{ questions: [ROLLOUT] },
		BASE_TS + 10_000,
	);
	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "click answer");
		const card = activeAsk(page);
		await card.getByTestId("ask-option").nth(1).click();
		await card.getByTestId("ask-submit").click();
		const receipt = page
			.getByTestId("chat-scroll")
			.locator('[data-testid="ask-user-question"][data-tone="answered"]');
		await expect(receipt).toContainText("Rollout beta");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const active = document.activeElement;
					return (
						active instanceof HTMLElement &&
						active.matches("[data-transcript-item]") &&
						active.querySelector('[data-tone="answered"]') !== null &&
						!active.matches(":focus-visible")
					);
				}),
			)
			.toBe(true);
		await expect(composer(page)).not.toBeFocused();
		if (chromium()) await shot(page.getByTestId("chat-view"), "ask-keyboard", "receipt");

		await openPersistedChatAfterInput(page, "keyboard answer");
		await expect(card).toBeVisible();
		await pressPlatformShortcut(page, "1");
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await page.keyboard.press("Enter");
		await pressPlatformShortcut(page, "Enter");
		await expect(receipt).toContainText("Rollout alpha");
		await expect(composer(page)).toBeFocused();
	} finally {
		rmSync(clicked.path, { force: true });
		rmSync(typed.path, { force: true });
	}
});

test("a question arriving while the transcript is walked takes focus; Esc on a message or the feed goes back to it", async ({
	page,
}) => {
	const { held, path, card } = await openHeldRound(page, "arrival while walking");
	try {
		await composer(page).click();
		await pressPlatformShortcut(page, "ArrowUp");
		const walked = page.locator("[data-transcript-item]:focus");
		await expect(walked).toHaveCount(1);

		held.release();
		const option = card.getByTestId("ask-option").first();
		await expect(option).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveCount(0);

		await page.keyboard.press("Escape");
		await expect(composer(page)).toBeFocused();
		await pressPlatformShortcut(page, "ArrowUp");
		await expect(walked).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(option).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(composer(page)).toBeFocused();
		await page.locator("[data-transcript-feed]").focus();
		await page.keyboard.press("Escape");
		await expect(option).toBeFocused();
	} finally {
		rmSync(path, { force: true });
	}
});

test("a question arriving while a draft is typed keeps focus in the composer and says how to answer; Esc goes to it and back", async ({
	page,
}) => {
	const { held, path, card } = await openHeldRound(page, "arrival while typing");
	try {
		await composer(page).click();
		await composer(page).fill("half a reply");
		await expect(composer(page)).toBeFocused();

		held.release();
		await expect(card).toBeVisible();
		await expect(
			card.locator('[role="status"]').filter({ hasText: "Agent asks a question" }),
		).toHaveText("Agent asks a question — F6 to answer");
		await expect(composer(page)).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveText("waiting · F6 to answer");

		await page.keyboard.press("Escape");
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await expect(composer(page)).toHaveValue("half a reply");
		await page.keyboard.press("Escape");
		await expect(composer(page)).toBeFocused();
		await expect(composer(page)).toHaveValue("half a reply");
	} finally {
		rmSync(path, { force: true });
	}
});

test("a question arriving while the composer is empty takes focus", async ({ page }) => {
	const { held, path, card } = await openHeldRound(page, "arrival from composer");
	try {
		await composer(page).click();
		await expect(composer(page)).toBeFocused();
		await expect(composer(page)).toHaveValue("");
		held.release();
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveCount(0);
	} finally {
		rmSync(path, { force: true });
	}
});

test("a question arriving after Mod+L put focus in the empty composer takes focus", async ({
	page,
}) => {
	const { held, path, card } = await openHeldRound(page, "arrival after the composer chord");
	try {
		await page.getByTestId("chat-scroll").click();
		await pressPlatformShortcut(page, "L");
		await expect(composer(page)).toBeFocused();
		await expect(composer(page)).toHaveValue("");
		held.release();
		await expect(card.locator("[data-focus-claim]")).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveCount(0);
	} finally {
		rmSync(path, { force: true });
	}
});

test("a question arriving after Mod+L won over an earlier one takes focus", async ({ page }) => {
	const { held, path, card } = await openHeldRound(page, "arrival after the chord won");
	try {
		await expect(composer(page)).not.toHaveAttribute("placeholder", /replaces the question/);
		held.waitOn("ask-keys-earlier");
		await expect(composer(page)).toHaveAttribute("placeholder", /replaces the question/);
		await blur(page);
		await pressPlatformShortcut(page, "L");
		await expect(composer(page)).toBeFocused();
		held.release();
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveCount(0);
	} finally {
		rmSync(path, { force: true });
	}
});

test("a question arriving while a mouse-focused button holds focus takes it", async ({ page }) => {
	test.skip(
		!chromium(),
		"WebKit never focuses a clicked button; its History-button case is every openRound",
	);
	const { held, path, card } = await openHeldRound(page, "arrival after a click");
	try {
		const tab = page
			.locator('[data-testid="editor-tab"][data-kind="chat"]')
			.filter({ hasText: "arrival after a click" })
			.getByRole("tab");
		await tab.click();
		await expect(tab).toBeFocused();
		expect(await tab.evaluate((element) => element.matches(":focus-visible"))).toBe(false);

		held.release();
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveCount(0);
	} finally {
		rmSync(path, { force: true });
	}
});

test("a question arriving while a keyboard-focused button holds focus takes it", async ({
	page,
}) => {
	const { held, path, card } = await openHeldRound(page, "arrival after a tab");
	try {
		await composer(page).click();
		await page.keyboard.press("Tab");
		const tabbed = await page.evaluate(() => {
			const active = document.activeElement;
			if (!active || active === document.body || active.matches('[data-testid="chat-input"]')) {
				return null;
			}
			return { tag: active.tagName, visible: active.matches(":focus-visible") };
		});
		expect(tabbed).not.toBeNull();
		if (chromium()) expect(tabbed).toEqual({ tag: "BUTTON", visible: true });

		held.release();
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveCount(0);
	} finally {
		rmSync(path, { force: true });
	}
});

test("after Mod+L remounts the chat, the composer keeps focus over the waiting question", async ({
	page,
}) => {
	const { card, path } = await openRound(page, "remount race", { questions: [ROLLOUT] });
	try {
		await revealWorkbenchTool(page, "files");
		await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
		await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveAttribute(
			"data-active",
			"true",
		);
		await expect(card).toHaveCount(0);

		await pressPlatformShortcut(page, "L");
		await expect(card).toBeVisible();
		await expect(composer(page)).toBeFocused();
		await settleFrames(page, 12);
		await expect(composer(page)).toBeFocused();
		await expect(card.getByTestId("ask-option").first()).not.toBeFocused();
	} finally {
		rmSync(path, { force: true });
	}
});

test("Mod+L over a waiting question keeps it from taking focus again after a tab switch", async ({
	page,
}) => {
	const name = "chord across tabs";
	const { card, path } = await openRound(page, name, { questions: [ROLLOUT] });
	try {
		await pressPlatformShortcut(page, "L");
		await expect(composer(page)).toBeFocused();
		await revealWorkbenchTool(page, "files");
		await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
		const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
		await expect(readme).toHaveAttribute("data-active", "true");
		await expect(card).toHaveCount(0);

		const chatTab = page
			.locator('[data-testid="editor-tab"][data-kind="chat"]')
			.filter({ hasText: name })
			.getByRole("tab");
		await readme.getByRole("tab").focus();
		await page.keyboard.press("ArrowLeft");
		await expect(chatTab).toBeFocused();
		await expect(card).toBeVisible();
		await settleFrames(page, 12);
		await expect(chatTab).toBeFocused();
		await expect(card.getByTestId("ask-option").first()).not.toBeFocused();
		await expect(card.getByTestId("ask-waiting")).toHaveText("waiting · F6 to answer");
	} finally {
		rmSync(path, { force: true });
	}
});

test("Esc climbs from a side panel to the waiting question", async ({ page }) => {
	const { card, path } = await openRound(page, "climb to the question", { questions: [ROLLOUT] });
	try {
		await pressPlatformShortcut(page, "Shift+E");
		const row = page.locator('[data-testid="file-node"]:focus');
		await expect(row).toHaveCount(1);
		await page.keyboard.press("ArrowDown");
		await expect(row).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
	} finally {
		rmSync(path, { force: true });
	}
});

test("i enters an HTML preview with a ring and Tab returns to the option; c opens compare and Esc comes back", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1400, height: 1000 });
	const mockup = join(E2E_FIXTURE_REPO, MOCKUPS, "recorder.html");
	mkdirSync(dirname(mockup), { recursive: true });
	writeFileSync(mockup, RECORDER);
	const { card, path } = await openRound(page, "preview keys", PREVIEWED);
	try {
		const options = card.getByTestId("ask-option");
		const pane = card.getByTestId("ask-preview");
		const frame = pane.locator("iframe");
		await expect(pane.getByTestId("html-frame-box")).toBeVisible();
		await expect(frame).toHaveAttribute("tabindex", "-1");
		await expect(card.getByTestId("ask-shortcuts")).toContainText("I interact");
		await expect(options.first()).toBeFocused();

		await page.keyboard.press("i");
		await expect(frame).toBeFocused();
		await expect(pane.getByTestId("ask-preview-frame-legend")).toHaveText("Tab out to return");
		await expect(pane.getByTestId("ask-preview-body")).toHaveCSS("outline-style", "solid");
		if (chromium()) await shot(card, "ask-keyboard", "frame");

		for (let press = 0; press < 4 && !(await isFocused(options.first())); press += 1) {
			await page.keyboard.press("Tab");
		}
		await expect(options.first()).toBeFocused();
		await expect(pane.getByTestId("ask-preview-interact")).toBeVisible();
		await expect(pane.getByTestId("ask-preview-body")).toHaveCSS("outline-style", "none");

		await page.keyboard.press("c");
		const overlay = page.getByTestId("ask-compare");
		await expect(overlay).toBeVisible();
		const body = overlay.getByTestId("ask-compare-body");
		await expect(body).toBeFocused();
		await expect(body).toHaveAttribute(
			"aria-keyshortcuts",
			/^ArrowLeft ArrowRight 1 2 3 Enter Escape$/,
		);
		await page.keyboard.press("Escape");
		await expect(overlay).toBeHidden();
		await expect(options.first()).toBeFocused();
	} finally {
		rmSync(path, { force: true });
		rmSync(join(E2E_FIXTURE_REPO, ".thinkrail"), { recursive: true, force: true });
	}
});

test("while collapsed, the submit chord expands the sheet to ask for a choice and Shift+Esc skips", async ({
	page,
}) => {
	const { card, path } = await openRound(page, "collapsed keys", ROUND);
	try {
		const toggle = card.getByTestId("ask-collapse");
		await toggle.click();
		await expect(card).toHaveAttribute("data-collapsed", "true");
		await toggle.focus();
		await pressPlatformShortcut(page, "Enter");
		await expect(card).toHaveAttribute("data-collapsed", "false");
		await expect(card.getByTestId("ask-needs-choice")).toBeVisible();

		await toggle.click();
		await expect(card).toHaveAttribute("data-collapsed", "true");
		await toggle.focus();
		await page.keyboard.press("Shift+Escape");
		await expect(
			page
				.getByTestId("chat-scroll")
				.locator('[data-testid="ask-user-question"][data-tone="skipped"]'),
		).toBeVisible();
		await expect(composer(page)).toBeFocused();
	} finally {
		rmSync(path, { force: true });
	}
});

test("↓ reaches Skip before the primary button, ←/→ move between them without paging, Home/End page the tabs", async ({
	page,
}) => {
	const { card, path } = await openRound(page, "foot keys", ROUND);
	try {
		const question = card.getByTestId("ask-question-text");
		await page.keyboard.press("End");
		await expect(card.getByTestId("ask-custom")).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(card.getByTestId("ask-skip")).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(card.getByTestId("ask-continue")).toBeFocused();
		await expect(question).toHaveText(ROLLOUT.question);
		await page.keyboard.press("ArrowLeft");
		await expect(card.getByTestId("ask-skip")).toBeFocused();
		await expect(question).toHaveText(ROLLOUT.question);
		await page.keyboard.press("ArrowDown");
		await expect(card.getByTestId("ask-continue")).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(card.getByTestId("ask-option").first()).toBeFocused();

		const tabs = card.getByTestId("ask-tab");
		await tabs.first().focus();
		await page.keyboard.press("End");
		await expect(question).toHaveText("Which checks should the keys run?");
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await tabs.nth(1).focus();
		await page.keyboard.press("Home");
		await expect(question).toHaveText(ROLLOUT.question);
	} finally {
		rmSync(path, { force: true });
	}
});

test("keys that move focus scroll the docked sheet just enough to show it, never the transcript", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 760 });
	await openFixtureProject(page);
	const session = seedQuestionnaire("tall keys", "ask-keys-tall", TALL, BASE_TS, LONG_PROMPT);
	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "tall keys");
		const card = activeAsk(page);
		const options = card.getByTestId("ask-option");
		const other = card.getByTestId("ask-custom");
		const body = card.getByTestId("ask-dock-body");
		const dock = page.getByTestId("chat-dock");
		const transcript = page.getByTestId("chat-scroll").locator("[data-virtuoso-scroller]");
		await expect(options.first()).toBeFocused();
		await waitForScrollStability(page.getByTestId("chat-scroll"));
		const transcriptTop = await scrollTopOf(transcript);
		expect(transcriptTop).toBeGreaterThan(0);
		const dockBox = await dock.boundingBox();
		expect(await scrollTopOf(body)).toBe(0);

		let top = 0;
		for (let index = 1; index < TALL_COUNT; index += 1) {
			await page.keyboard.press("ArrowDown");
			await expect(options.nth(index)).toBeFocused();
			expect(await focusShownIn(body), `option ${index + 1} is fully visible`).toBe(true);
			const next = await scrollTopOf(body);
			expect(next).toBeGreaterThanOrEqual(top);
			top = next;
		}
		expect(top).toBeGreaterThan(0);
		if (chromium()) await shot(page.getByTestId("chat-view"), "ask-keyboard", "dock-scrolled");

		await page.keyboard.press("Space");
		await expect(card.getByTestId("ask-note")).toBeFocused();
		await expect.poll(() => focusShownIn(body)).toBe(true);
		await page.keyboard.type("Keep it short.");
		await page.keyboard.press("Enter");
		await expect(card.getByTestId("ask-note-toggle")).toBeFocused();
		await expect.poll(() => focusShownIn(body)).toBe(true);
		await page.keyboard.press("ArrowDown");
		await expect(other).toBeFocused();
		await expect.poll(() => focusShownIn(body)).toBe(true);
		const bottom = await scrollTopOf(body);

		for (const [key, control] of [
			["ArrowDown", "ask-skip"],
			["ArrowRight", "ask-submit"],
			["ArrowLeft", "ask-skip"],
			["ArrowDown", "ask-submit"],
		] as const) {
			await page.keyboard.press(key);
			await expect(card.getByTestId(control)).toBeFocused();
			await expect(card.getByTestId(control)).toBeInViewport({ ratio: 1 });
		}
		expect(await scrollTopOf(body)).toBe(bottom);

		await page.keyboard.press("ArrowDown");
		await expect(options.first()).toBeFocused();
		await expect.poll(() => focusShownIn(body)).toBe(true);
		expect(await scrollTopOf(body)).toBeLessThan(bottom);
		await page.keyboard.press("End");
		await expect(other).toBeFocused();
		await expect.poll(() => focusShownIn(body)).toBe(true);
		await page.keyboard.press("ArrowUp");
		await expect(options.last()).toBeFocused();
		await expect.poll(() => focusShownIn(body)).toBe(true);
		const beforeHome = await scrollTopOf(body);
		await page.keyboard.press("Home");
		await expect(options.first()).toBeFocused();
		await expect.poll(() => focusShownIn(body)).toBe(true);
		expect(await scrollTopOf(body)).toBeLessThan(beforeHome);

		expect(await scrollTopOf(transcript)).toBe(transcriptTop);
		expect(await dock.boundingBox()).toEqual(dockBox);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test.describe("a tab-strip key rebound over a global chord", () => {
	test.afterEach(async ({ page }) => resetKeybindings(page));

	test("Close tab on Mod+L acts on a workbench tab only; a question tab still sends Mod+L to the composer", async ({
		page,
	}) => {
		const { card, path } = await openRound(page, "close tab on focus chord", ROUND);
		try {
			await setKeybindings(page, { "tabs.close": ["Mod+KeyL"] });
			const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
			const chatTab = chatTabs.getByRole("tab");
			await expect(chatTab).toHaveAttribute("aria-keyshortcuts", /(Control|Meta)\+L\b/);

			await card.getByTestId("ask-tab").nth(1).focus();
			await pressPlatformShortcut(page, "L");
			await expect(composer(page)).toBeFocused();
			await expect(chatTabs).toHaveCount(1);

			await chatTab.focus();
			await pressPlatformShortcut(page, "L");
			await expect(chatTabs).toHaveCount(0);
		} finally {
			rmSync(path, { force: true });
		}
	});
});

test.describe("the card's letters", () => {
	test.afterEach(async ({ page }) => resetKeybindings(page));

	test("a rebound Discuss letter works and the default no longer does", async ({ page }) => {
		const { card, path } = await openRound(page, "rebound discuss", { questions: [ROLLOUT] });
		try {
			await setKeybindings(page, { "ask-user-question.discuss": ["KeyX"] });
			await expect(card.getByTestId("ask-shortcuts")).toContainText("X discuss");
			await page.keyboard.press("d");
			await settleFrames(page);
			await expect(card.getByTestId("ask-discuss-panel")).toHaveCount(0);
			await page.keyboard.press("x");
			await expect(card.getByTestId("ask-discuss-text")).toBeFocused();
		} finally {
			rmSync(path, { force: true });
		}
	});

	test("a Discuss rebound to a Mod chord works on a focused option, and the submit chord still submits", async ({
		page,
	}) => {
		const { card, path } = await openRound(page, "chord discuss", { questions: [ROLLOUT] });
		try {
			await setKeybindings(page, { "ask-user-question.discuss": ["Mod+KeyD"] });
			const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform)))
				? "⌘"
				: "Ctrl+";
			await expect(card.getByTestId("ask-shortcuts")).toContainText(`${mod}D discuss`);
			const options = card.getByTestId("ask-option");
			await expect(options.first()).toBeFocused();
			await pressPlatformShortcut(page, "Enter");
			await expect(card.getByTestId("ask-needs-choice")).toBeVisible();
			await expect(options.first()).toHaveAttribute("aria-checked", "false");

			await options.first().focus();
			await page.keyboard.press("d");
			await settleFrames(page);
			await expect(card.getByTestId("ask-discuss-panel")).toHaveCount(0);
			await pressPlatformShortcut(page, "d");
			await expect(card.getByTestId("ask-discuss-text")).toBeFocused();
		} finally {
			rmSync(path, { force: true });
		}
	});

	test("Settings → Keyboard lists the card's local keys under its own section, the locked ones too", async ({
		page,
	}) => {
		await openFixtureProject(page);
		await openSettingsSection(page, "keyboard");
		const section = page.locator(
			'[data-testid="keybinding-section"][data-section="ask-user-question"]',
		);
		const area = section.getByTestId("keybinding-group");
		await expect(area).toContainText("Ask user question");
		await expect(area).toHaveAttribute("aria-expanded", "false");
		await area.click();
		await expect(area).toHaveAttribute("aria-expanded", "true");
		await expect(section.getByTestId("keybinding-scope").first()).toHaveText(
			/when focus is in Ask user question/,
		);
		const row = (command: string) =>
			section.locator(`[data-testid="keybinding-row"][data-command="${command}"]`);
		await expect(row("ask-user-question.discuss").getByTestId("keybinding-chord")).toContainText(
			"D",
		);
		const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform)))
			? "⌘"
			: "Ctrl";
		await expect(
			row("ask-user-question.submit").getByTestId("keybinding-chord").locator("kbd"),
		).toHaveText([mod, "↵", mod, "Num ↵"]);
		await expect(row("ask-user-question.move")).toHaveAttribute("data-locked", "true");
	});

	test("d marks Discuss by its physical key on a Russian layout", async ({ page }) => {
		const { card, path } = await openRound(page, "russian discuss", { questions: [ROLLOUT] });
		try {
			await card
				.getByTestId("ask-option")
				.first()
				.dispatchEvent("keydown", { key: "в", code: "KeyD", bubbles: true, cancelable: true });
			await expect(card.getByTestId("ask-discuss-text")).toBeFocused();
		} finally {
			rmSync(path, { force: true });
		}
	});
});
