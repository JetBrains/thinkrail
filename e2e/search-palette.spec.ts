import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
	MATCH_TIER,
	MAX_SEARCH_PREVIEW_BYTES,
	MAX_SEARCH_QUERY_LENGTH,
	SEARCH_PROTOCOL_VERSION,
	WS_CHANNELS,
	type WsClientMessage,
	type WsParams,
} from "@thinkrail/contracts";
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

		await page.getByTestId("open-search").click();
		await expect(palette(page)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(palette(page)).toBeHidden();
		await expect(page.getByTestId("open-search")).toBeFocused();

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

test("typing finds chats by title, a paste is cut to the host's query length, and Escape clears before it closes", async ({
	page,
}) => {
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

		await page.getByTestId("search-input").fill("");
		await page.keyboard.insertText("x".repeat(MAX_SEARCH_QUERY_LENGTH + 20));
		await expect(page.getByTestId("search-input")).toHaveValue("x".repeat(MAX_SEARCH_QUERY_LENGTH));

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

test("picking a chat or a workspace puts the cursor in the chat input, unless the workspace shows a non-chat tab", async ({
	page,
}) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	await openFixtureProject(page);
	const seeded = seedWorkspaceSession(repo, {
		name: "Zebra migration plan",
		messages: [
			{ role: "user", text: "move the tables", timestamp: BASE_TS + 20 },
			{ role: "assistant", text: "moved", timestamp: BASE_TS + 21 },
		],
	});
	const focusedChat = page.locator(
		'[data-testid="chat-view"]:has([data-testid="chat-input"]:focus)',
	);
	const workspaceRow = palette(page).locator('[data-testid="search-row"][data-kind="workspace"]');
	try {
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(page.getByTestId("welcome")).toBeVisible();

		await openPalette(page);
		await page.getByTestId("search-input").fill("zebra");
		await expect(
			palette(page).locator(`[data-testid="search-row"][data-item-id="chat:${seeded.id}"]`),
		).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("Enter");
		await expect(palette(page)).toBeHidden();
		await expect(focusedChat).toContainText("move the tables");

		await page.getByTestId("open-search").focus();
		await openPalette(page);
		await page.getByTestId("search-input").fill("@");
		await workspaceRow.first().click();
		await expect(palette(page)).toBeHidden();
		await expect(focusedChat).toContainText("move the tables");

		await openPalette(page);
		await page.getByTestId("search-input").fill("/notes");
		const file = palette(page).locator('[data-testid="search-row"][data-kind="file"]', {
			hasText: "notes.txt",
		});
		await expect(file).toBeVisible({ timeout: 15_000 });
		await file.click();
		await expect(palette(page)).toBeHidden();
		const fileTab = page.locator('[data-testid="editor-tab"][data-kind="file"]', {
			hasText: "notes.txt",
		});
		await expect(fileTab).toHaveAttribute("data-active", "true");
		await expect(focusedChat).toHaveCount(0);

		await openPalette(page);
		await page.getByTestId("search-input").fill("@");
		await workspaceRow.first().click();
		await expect(palette(page)).toBeHidden();
		await nextFrame(page);
		await expect(fileTab).toHaveAttribute("data-active", "true");
		await expect(focusedChat).toHaveCount(0);
	} finally {
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

test("double Shift toggles the palette and can be turned off in the Keyboard settings", async ({
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

test("the double-Shift row opens the Keyboard settings, and Ctrl+R stays inert under the palette", async ({
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
		const commandsChip = await page
			.getByTestId("search-chip")
			.evaluateAll((chips) =>
				chips.findIndex((chip) => chip.getAttribute("data-scope") === "commands"),
			);
		await page.keyboard.press(`Alt+${commandsChip + 1}`);
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

test("host search: a file by name opens as a tab, a spec by body opens in the Specs tool", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("/notes");
	await expect(page.locator('[data-testid="search-chip"][data-scope="files"]')).toHaveAttribute(
		"data-active",
		"true",
	);
	const file = page.locator('[data-testid="search-row"][data-kind="file"]', {
		hasText: "notes.txt",
	});
	await expect(file).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("search-host-pending")).toHaveCount(0);
	await pressPlatformShortcut(page, "i");
	const preview = page.getByTestId("search-file-preview");
	await expect(preview).toContainText("plain-text-fixture");
	await expect
		.poll(async () => (await preview.locator(".monaco-editor").boundingBox())?.height ?? 0)
		.toBeGreaterThan(100);
	await pressPlatformShortcut(page, "i");
	await file.click();
	await expect(palette(page)).toBeHidden();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "notes.txt" }),
	).toBeVisible();

	await openPalette(page);
	await page.getByTestId("search-input").fill("#SPECGRAPHPROBE");
	const spec = page.locator('[data-testid="search-row"][data-kind="spec"]');
	await expect(spec).toHaveCount(1, { timeout: 15_000 });
	await expect(spec).toContainText("Sample Project");
	await expect(spec).toContainText("SPECGRAPHPROBE");
	await pressPlatformShortcut(page, "i");
	await expect(preview.getByRole("heading", { name: "Goal" })).toBeVisible();
	await pressPlatformShortcut(page, "i");
	await page.keyboard.press("Enter");
	await expect(palette(page)).toBeHidden();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "SPEC.md" }),
	).toBeVisible();
});

test("host search: an image and an HTML file render in the preview pane, and from Project Home a hit enters the project's workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	await expect(defaultWorkspaceRow(page)).not.toHaveAttribute("data-active", "true");
	const imageBytes = page.waitForRequest((request) => request.url().includes("RENDERERS.png"));
	await openPalette(page);
	await page.getByTestId("search-input").fill("/RENDERERS.png");
	const image = page.locator('[data-testid="search-row"][data-kind="file"]', {
		hasText: "RENDERERS.png",
	});
	await expect(image).toBeVisible({ timeout: 15_000 });
	await pressPlatformShortcut(page, "i");
	const preview = page.getByTestId("search-file-preview");
	await expect(preview.getByTestId("image-resource")).toBeVisible();
	expect(new URL((await imageBytes).url()).searchParams.get("maxBytes")).toBe(
		String(MAX_SEARCH_PREVIEW_BYTES),
	);

	await page.getByTestId("search-input").fill("/sample.html");
	await expect(
		page.locator('[data-testid="search-row"][data-kind="file"]', { hasText: "sample.html" }),
	).toBeVisible({ timeout: 15_000 });
	await expect(preview.getByTestId("html-view")).toBeVisible();
	const frame = preview.frameLocator("iframe");
	await expect(frame.getByRole("heading", { name: "HTML fixture" })).toBeVisible();
	await expect(frame.locator("body")).not.toContainText("script-ran");
	await pressPlatformShortcut(page, "i");

	await page.getByTestId("search-input").fill("/notes");
	const file = page.locator('[data-testid="search-row"][data-kind="file"]', {
		hasText: "notes.txt",
	});
	await expect(file).toBeVisible({ timeout: 15_000 });
	await page.keyboard.press("Enter");
	await expect(palette(page)).toBeHidden();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "notes.txt" }),
	).toBeVisible();
});

test("host search: a transcript hit jumps to its message and the preview shows the window around it", async ({
	page,
}) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	await openFixtureProject(page);
	const seeded = seedWorkspaceSession(repo, {
		name: "Watcher chat",
		messages: [
			{ role: "user", text: "first question", timestamp: BASE_TS },
			{ role: "assistant", text: "first answer", timestamp: BASE_TS + 1 },
			{ role: "user", text: "where is the quantum banana", timestamp: BASE_TS + 2 },
			{
				role: "assistant",
				text: "The quantum banana lives in the fridge.",
				timestamp: BASE_TS + 3,
			},
		],
	});
	try {
		await page.reload();
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await enterDefaultWorkspace(page);
		await openPalette(page);
		await page.getByTestId("search-input").fill("quantum banana");
		const transcripts = page.locator('[data-testid="search-row"][data-kind="transcript"]');
		await expect(transcripts).toHaveCount(2, { timeout: 15_000 });
		await expect(transcripts.first()).toContainText("quantum banana");
		await expect(transcripts.first().locator("mark").first()).toBeVisible();

		await pressPlatformShortcut(page, "i");
		await transcripts.first().hover();
		const preview = page.getByTestId("search-host-preview");
		await expect(preview).toHaveAttribute("data-state", "transcript");
		await expect(preview).toContainText("first question");
		await expect(preview.locator("[data-focus='true']")).toContainText("quantum banana");
		await pressPlatformShortcut(page, "i");

		await transcripts.first().click();
		await expect(palette(page)).toBeHidden();
		const flashed = page.locator("[data-flash]");
		await expect(flashed).toBeVisible({ timeout: 15_000 });
		await expect(flashed).toContainText("quantum banana");
	} finally {
		rmSync(seeded.path, { force: true });
	}
});

test("host rows that land after the user moved the selection never push it or the rows above it", async ({
	page,
}) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	const shown = ["a", "b", "c", "d"].map((name) => `zz-${name}-zqxprobe.ts`);
	const better = ["1", "2", "3", "4", "5"].map((name) => `zqxprobe-${name}.ts`);
	for (const name of [...shown, ...better]) writeFileSync(join(repo, name), "probe\n");
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const groups = (params: WsParams<"search.query">, names: readonly string[], state: string) =>
		(params.kinds ?? []).map((kind) =>
			kind === "file"
				? {
						kind,
						state,
						total: names.length,
						hits: names.map((name) => ({
							id: `file:${params.context.workspaceId}:${name}`,
							kind,
							title: name,
							tier: name.startsWith("zqxprobe") ? MATCH_TIER.prefix : MATCH_TIER.substring,
							score: 1,
							projectId: params.context.projectId,
							workspaceId: params.context.workspaceId,
							path: name,
						})),
					}
				: { kind, state: "ready", total: 0, hits: [] },
		);
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		let answered = 0;
		socket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as WsClientMessage;
			if (
				!("method" in frame) ||
				frame.method !== "search.query" ||
				(frame.params as WsParams<"search.query">).query !== "zqxprobe"
			) {
				server.send(message);
				return;
			}
			const query = frame.params as WsParams<"search.query">;
			const reply = (names: readonly string[], state: string) =>
				socket.send(
					JSON.stringify({
						id: frame.id,
						ok: true,
						result: { groups: groups(query, names, state) },
					}),
				);
			answered += 1;
			if (answered === 1) reply(shown, "indexing");
			else void released.then(() => reply([...shown, ...better], "ready"));
		});
		server.onMessage((message) => socket.send(message));
	});
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await openPalette(page);
		await page.getByTestId("search-input").fill("zqxprobe");
		const files = page.locator('[data-testid="search-row"][data-kind="file"]');
		await expect(files).toHaveCount(4, { timeout: 15_000 });
		await page.keyboard.press("ArrowDown");
		const selected = page.locator('[data-testid="search-row"][aria-selected="true"]');
		await expect(selected).toContainText("zz-b-zqxprobe.ts");
		release();
		await expect(page.getByTestId("search-host-pending")).toHaveCount(0, { timeout: 15_000 });
		await expect(page.locator('[data-testid="search-row"][data-kind="more"]')).toContainText("5");
		await expect(files.nth(0)).toContainText("zz-a-zqxprobe.ts");
		await expect(files.nth(1)).toContainText("zz-b-zqxprobe.ts");
		await expect(selected).toContainText("zz-b-zqxprobe.ts");
		await page.keyboard.press("Enter");
		await expect(
			page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "zz-b-zqxprobe.ts" }),
		).toBeVisible();
	} finally {
		for (const name of [...shown, ...better]) rmSync(join(repo, name), { force: true });
	}
});

test("the preview pane reads a file only under its cap, and a refresh after it grew past the cap is refused", async ({
	page,
}) => {
	const notes = join(realpathSync(E2E_FIXTURE_REPO), "notes.txt");
	const original = readFileSync(notes);
	const reads: { maxBytes?: number | undefined; refused: boolean; grown: boolean }[] = [];
	let grown = false;
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		const asked = new Map<string, { maxBytes?: number | undefined; grown: boolean }>();
		socket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as WsClientMessage;
			if ("method" in frame && frame.method === "fs.readFile") {
				const params = frame.params as WsParams<"fs.readFile">;
				if (params.path === "notes.txt") asked.set(frame.id, { maxBytes: params.maxBytes, grown });
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { id?: string; errorCode?: string };
			const read = frame.id ? asked.get(frame.id) : undefined;
			if (frame.id && read) {
				reads.push({ ...read, refused: frame.errorCode === "FILE_TOO_LARGE" });
				asked.delete(frame.id);
			}
			socket.send(message);
		});
	});
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await openPalette(page);
		await page.getByTestId("search-input").fill("/notes");
		await expect(
			page.locator('[data-testid="search-row"][data-kind="file"]', { hasText: "notes.txt" }),
		).toBeVisible({ timeout: 15_000 });
		await pressPlatformShortcut(page, "i");
		const preview = page.getByTestId("search-file-preview");
		await expect(preview).toContainText("plain-text-fixture");
		grown = true;
		writeFileSync(notes, "x".repeat(MAX_SEARCH_PREVIEW_BYTES + 1));
		await expect
			.poll(() => reads.some((read) => read.grown && read.refused), { timeout: 15_000 })
			.toBe(true);
		await expect(preview).toContainText("Too large to preview here");
		expect(reads.filter((read) => read.grown).every((read) => read.refused)).toBe(true);
		expect(reads.every((read) => read.maxBytes === MAX_SEARCH_PREVIEW_BYTES)).toBe(true);
	} finally {
		writeFileSync(notes, original);
	}
});

test("start from the typed text: the Start work row and Mod+Enter open the Create-workspace dialog prefilled", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("Refactor the auth module");
	const startRow = page.locator('[data-testid="search-row"][data-item-id="start"]');
	await expect(startRow).toContainText("Start work with “Refactor the auth module”");
	await startRow.click();
	await expect(palette(page)).toBeHidden();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-prompt")).toHaveValue("Refactor the auth module");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	await openPalette(page);
	await page.getByTestId("search-input").fill(">Write release notes");
	await expect(startRow).toHaveCount(0);
	await page.getByTestId("search-input").fill("Write release notes");
	await pressPlatformShortcut(page, "Enter");
	await expect(palette(page)).toBeHidden();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-prompt")).toHaveValue("Write release notes");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("a held Enter or Mod+Enter opens the Create-workspace dialog once and never submits it", async ({
	page,
}) => {
	const creates: string[] = [];
	page.on("websocket", (socket) =>
		socket.on("framesent", ({ payload }) => {
			const frame = JSON.parse(String(payload)) as { method?: string; id?: string };
			if (frame.method === "workspace.create") creates.push(frame.id ?? "");
		}),
	);
	const repeat = (key: string, mod = false) =>
		page.evaluate(
			({ key: name, mod: withMod }) => {
				const mac = /Mac|iPhone|iPad/.test(navigator.platform);
				document.activeElement?.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: name,
						repeat: true,
						bubbles: true,
						cancelable: true,
						metaKey: withMod && mac,
						ctrlKey: withMod && !mac,
					}),
				);
			},
			{ key, mod },
		);
	await openFixtureProject(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("Refactor the auth module");
	await expect(page.locator('[data-testid="search-row"][data-item-id="start"]')).toBeVisible();
	await repeat("Enter", true);
	await repeat("Enter");
	await expect(palette(page)).toBeVisible();
	await pressPlatformShortcut(page, "Enter");
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-prompt")).toBeFocused();
	await repeat("Enter");
	await repeat("Enter");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("create-workspace")).toBeEnabled();
	expect(creates).toEqual([]);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("a Start row the user selected keeps its place and its Enter when host rows land after it", async ({
	page,
}) => {
	const name = "zz-startprobe.ts";
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as WsClientMessage;
			if (
				!("method" in frame) ||
				frame.method !== "search.query" ||
				(frame.params as WsParams<"search.query">).query !== "startprobe"
			) {
				server.send(message);
				return;
			}
			const query = frame.params as WsParams<"search.query">;
			void released.then(() =>
				socket.send(
					JSON.stringify({
						id: frame.id,
						ok: true,
						result: {
							groups: (query.kinds ?? []).map((kind) =>
								kind === "file"
									? {
											kind,
											state: "ready",
											total: 1,
											hits: [
												{
													id: `file:${query.context.workspaceId}:${name}`,
													kind,
													title: name,
													tier: MATCH_TIER.prefix,
													score: 1,
													projectId: query.context.projectId,
													workspaceId: query.context.workspaceId,
													path: name,
												},
											],
										}
									: { kind, state: "ready", total: 0, hits: [] },
							),
						},
					}),
				),
			);
		});
		server.onMessage((message) => socket.send(message));
	});
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("startprobe");
	const rows = page.getByTestId("search-row");
	const start = page.locator('[data-testid="search-row"][data-item-id="start"]');
	await expect(rows).toHaveCount(1);
	await expect(page.getByTestId("search-host-pending")).toHaveCount(1);
	await page.keyboard.press("ArrowDown");
	await expect(start).toHaveAttribute("aria-selected", "true");
	release();
	await expect(page.locator('[data-testid="search-row"][data-kind="file"]')).toContainText(name);
	await expect(page.getByTestId("search-host-pending")).toHaveCount(0);
	await expect(rows.first()).toHaveAttribute("data-item-id", "start");
	await expect(start).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Enter");
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-prompt")).toHaveValue("startprobe");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("an older host gets the local scopes only, with a notice, and never a search.query", async ({
	page,
}) => {
	const hostRequests: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { method?: string };
			if (frame.method?.startsWith("search.")) hostRequests.push(frame.method);
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				channel?: string;
				data: { protocolVersion: number };
			};
			if (frame.channel === WS_CHANNELS.serverWelcome) {
				frame.data.protocolVersion = SEARCH_PROTOCOL_VERSION - 1;
				socket.send(JSON.stringify(frame));
			} else socket.send(message);
		});
	});
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openPalette(page);
	const notice = page.getByTestId("search-notice");
	await expect(notice).toContainText("doesn't search files");
	await expect(notice).toHaveAttribute("data-kind", "info");
	await expect(page.locator('[data-testid="search-chip"][data-scope="files"]')).toHaveCount(0);
	await page.clock.install();
	await page.getByTestId("search-input").fill("/notes");
	await expect(page.getByTestId("search-input")).toHaveValue("/notes");
	await page.clock.runFor(1_000);
	await expect(page.locator('[data-testid="search-row"][data-kind="file"]')).toHaveCount(0);
	expect(hostRequests).toEqual([]);
});

test("an incomplete search shows a yellow mark whose tip names each reason, on hover or tap, and Escape closes only the tip", async ({
	page,
}) => {
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as WsClientMessage;
			if (
				!("method" in frame) ||
				frame.method !== "search.query" ||
				(frame.params as WsParams<"search.query">).query !== "zqxcut"
			) {
				server.send(message);
				return;
			}
			const params = frame.params as WsParams<"search.query">;
			const groups = (params.kinds ?? []).map((kind) =>
				kind === "file"
					? {
							kind,
							state: "ready",
							total: 1,
							cut: { time: true, fileList: 128_000 },
							hits: [
								{
									id: `file:${params.context.workspaceId}:zqxcut.ts`,
									kind,
									title: "zqxcut.ts",
									tier: MATCH_TIER.prefix,
									score: 1,
									projectId: params.context.projectId,
									workspaceId: params.context.workspaceId,
									path: "zqxcut.ts",
								},
							],
						}
					: { kind, state: "ready", total: 0, hits: [] },
			);
			socket.send(JSON.stringify({ id: frame.id, ok: true, result: { groups } }));
		});
		server.onMessage((message) => socket.send(message));
	});
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("zqxcut");
	await expect(page.locator('[data-testid="search-row"][data-kind="file"]')).toHaveCount(1, {
		timeout: 15_000,
	});
	const mark = page.getByTestId("search-host-status");
	await expect(mark).toHaveAttribute("data-reasons", "fileList time");
	const tip = page.getByTestId("search-host-status-reasons");
	await mark.hover();
	await expect(tip).toContainText("Only 128,000 files in this folder are searched");
	await expect(tip).toContainText("The search ran out of time");
	const box = await page.getByTestId("search-input").boundingBox();
	await page.mouse.move((box?.x ?? 0) + 8, (box?.y ?? 0) + 8, { steps: 4 });
	await expect(tip).toBeHidden();

	const tap = async () => {
		await mark.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
		await mark.dispatchEvent("click");
	};
	await tap();
	await expect(tip).toBeVisible();
	await tap();
	await expect(tip).toBeHidden();
	await tap();
	await expect(tip).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(tip).toBeHidden();
	await expect(palette(page)).toBeVisible();
	await expect(page.getByTestId("search-input")).toHaveValue("zqxcut");
	await mark.click();
	await expect(page.getByTestId("search-input")).toBeFocused();
});

test("a dropped connection keeps the found rows and their scope, disabled until the host is back", async ({
	page,
}) => {
	let offline = false;
	let current: WebSocketRoute | undefined;
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		if (offline) {
			void socket.close();
			return;
		}
		current = socket;
		socket.connectToServer();
	});
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openPalette(page);
	await page.getByTestId("search-input").fill("/notes");
	const file = page.locator('[data-testid="search-row"][data-kind="file"]', {
		hasText: "notes.txt",
	});
	await expect(file).toBeVisible({ timeout: 15_000 });
	await expect(file).not.toHaveAttribute("aria-disabled", "true");

	offline = true;
	await current?.close();
	await expect(page.getByTestId("connection-status")).toHaveAttribute(
		"data-status",
		"disconnected",
	);
	await expect(file).toBeVisible();
	await expect(file).toHaveAttribute("aria-disabled", "true");
	await expect(page.locator('[data-testid="search-chip"][data-scope="files"]')).toHaveAttribute(
		"data-active",
		"true",
	);
	await page.keyboard.press("Enter");
	await expect(palette(page)).toBeVisible();

	offline = false;
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected", {
		timeout: 30_000,
	});
	await expect(file).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
	await page.keyboard.press("Enter");
	await expect(palette(page)).toBeHidden();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "notes.txt" }),
	).toBeVisible();
});
