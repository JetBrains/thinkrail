import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
	type AskUserQuestionArgs,
	SEARCH_PROTOCOL_VERSION,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
} from "./fixtures/app";
import { resolveBunExecutable } from "./fixtures/executables";
import { E2E_FIXTURE_REPO, E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_704_000_000_000;
const STDIO_SERVER = fileURLToPath(
	new URL("../packages/server/src/agent/mcp/fixtures/stdioServer.ts", import.meta.url),
);
const USER_MCP_CONFIG = join(E2E_PI_AGENT_DIR, "mcp.json");
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

test("the MCP page lists the workspace's servers with their state and switches one off in place", async ({
	page,
}) => {
	rmSync(USER_MCP_CONFIG, { force: true });
	writeFileSync(
		USER_MCP_CONFIG,
		JSON.stringify({
			mcpServers: { fixture: { command: resolveBunExecutable(), args: [STDIO_SERVER] } },
		}),
	);
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await openPalette(page);
		await page.getByTestId("search-input").fill(">mcp");
		await page.locator('[data-testid="search-row"][data-item-id="command:settings.mcp"]').click();
		await expect(page.getByTestId("search-crumb")).toContainText("MCP servers");
		const row = page.locator('[data-testid="search-row"][data-item-id="mcp:user:fixture"]');
		await expect(row).toContainText("Personal");
		await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "true");
		await row.click();
		await expect(row.getByTestId("search-toggle")).toHaveAttribute("data-on", "false", {
			timeout: 15_000,
		});
		await expect(palette(page)).toBeVisible();
		await expect(row).toContainText("Disabled");
	} finally {
		rmSync(USER_MCP_CONFIG, { force: true });
	}
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
	const preview = page.getByTestId("search-host-preview");
	await expect(preview).toHaveAttribute("data-state", "text");
	await expect(preview).toContainText("plain-text-fixture");
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
	await page.keyboard.press("Enter");
	await expect(palette(page)).toBeHidden();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "SPEC.md" }),
	).toBeVisible();
});

test("host search: from Project Home a file hit enters the project's workspace before opening the tab", async ({
	page,
}) => {
	await openFixtureProject(page);
	await expect(defaultWorkspaceRow(page)).not.toHaveAttribute("data-active", "true");
	await openPalette(page);
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
	await expect(page.getByTestId("search-notice")).toContainText("doesn't search files");
	await expect(page.locator('[data-testid="search-chip"][data-scope="files"]')).toHaveCount(0);
	await page.getByTestId("search-input").fill("/notes");
	await expect(page.getByTestId("search-input")).toHaveValue("/notes");
	await expect(page.locator('[data-testid="search-row"][data-kind="file"]')).toHaveCount(0);
	await page.waitForTimeout(500);
	expect(hostRequests).toEqual([]);
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
