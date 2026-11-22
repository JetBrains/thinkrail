import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import {
	closeSettings,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	loadPersistedWorkspaces,
	openFixtureProject,
	openSettingsSection,
	pressPlatformShortcut,
} from "./fixtures/app";
import { resetKeybindings, setKeybindings } from "./fixtures/keybindings";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import {
	CONTEXT_SESSIONS,
	EXPORT_SESSIONS,
	INSIGHTS_SESSIONS,
	PLAN_SESSIONS,
	PLANTED_SECRET,
	REPEAT_SESSION,
	SEQUENCE_MODELS,
	SEQUENCE_SESSIONS,
	STATS_SESSIONS,
	seedContextSession,
	seedExportSessions,
	seedExternalCwdSessions,
	seedInsightsSessions,
	seedPlanSessions,
	seedRepeatSession,
	seedSequenceSessions,
	seedStatsSessions,
	seedTimelineSessions,
	seedWorkspaceSession,
	TIMELINE_DAY,
	TIMELINE_SESSIONS,
} from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

const PANEL_COMMAND = "command:view.extension.session-insights.sessions";

async function defaultWorkspace(): Promise<Workspace> {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	let found: Workspace | undefined;
	await expect
		.poll(() => {
			found = loadPersistedWorkspaces().find(
				(workspace) => workspace.kind === "default" && workspace.worktreePath === repo,
			);
			return found !== undefined;
		})
		.toBe(true);
	if (!found) throw new Error("no Default workspace was persisted");
	return found;
}

/**
 * Opens the panel from the palette and refreshes until the index is ready and the list holds exactly
 * `rows` (session ids): the host's index may still list the previous test's sessions.
 */
async function openInsightsPanel(
	page: Page,
	{ rows }: { rows: readonly string[] },
): Promise<Locator> {
	await pressPlatformShortcut(page, "k");
	const palette = page.getByTestId("search-palette");
	await expect(palette).toBeVisible();
	await page.getByTestId("search-input").fill(">session insights");
	const command = palette.locator(`[data-testid="search-row"][data-item-id="${PANEL_COMMAND}"]`);
	await expect(command).toContainText("Open Session insights");
	await command.click();
	await expect(palette).toBeHidden();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="extension"]', {
			hasText: "Session insights",
		}),
	).toBeVisible();
	const panel = page.getByTestId("session-insights-panel");
	let attempt = 0;
	await expect(async () => {
		if (attempt++ > 0) await panel.getByTestId("session-insights-refresh").click();
		await expect(panel.getByTestId("session-insights-index")).toHaveAttribute(
			"data-phase",
			"ready",
			{ timeout: 1_000 },
		);
		await expect(panel.getByTestId("session-insights-row")).toHaveCount(rows.length, {
			timeout: 1_000,
		});
		for (const id of rows) await expect(insightsRow(panel, id)).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
	return panel;
}

const INSIGHTS_ROWS = [
	INSIGHTS_SESSIONS.priced.id,
	INSIGHTS_SESSIONS.unpriced.id,
	INSIGHTS_SESSIONS.delegating.id,
];
const STATS_ROWS = [STATS_SESSIONS.first.id, STATS_SESSIONS.second.id, STATS_SESSIONS.bridge.id];

/** Opens the palette on `query` and returns its Session insights row (absent while the extension is off). */
async function paletteRow(page: Page, query: string): Promise<Locator> {
	await pressPlatformShortcut(page, "k");
	const palette = page.getByTestId("search-palette");
	await expect(palette).toBeVisible();
	await page.getByTestId("search-input").fill(query);
	return palette.locator(`[data-testid="search-row"][data-item-id="${PANEL_COMMAND}"]`);
}

/** Escape clears a typed query before it closes the palette. */
async function closePalette(page: Page): Promise<void> {
	await page.getByTestId("search-input").fill("");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("search-palette")).toBeHidden();
}

function restoredChatTab(page: Page, sessionId: string): Locator {
	return page.locator(
		`[data-testid="editor-tab"][data-kind="chat"][data-session-id="${sessionId}"]`,
	);
}

function insightsRow(panel: Locator, sessionId: string): Locator {
	return panel.locator(`[data-testid="session-insights-row"][data-session-id="${sessionId}"]`);
}

async function expectBadges(scope: Locator, origins: readonly string[]): Promise<void> {
	const badges = scope.getByTestId("session-insights-badge");
	await expect(badges).toHaveCount(origins.length);
	for (const [index, origin] of origins.entries())
		await expect(badges.nth(index)).toHaveAttribute("data-origin", origin);
}

const FIGURE_COLUMNS = ["start", "active", "tokens", "cost", "calls", "errors", "subagents"];

async function expectFiguresUncut(row: Locator): Promise<void> {
	for (const column of FIGURE_COLUMNS) {
		const cut = await row.getByTestId(`session-insights-${column}`).evaluate((cell) => {
			const box = cell.getBoundingClientRect();
			return [...cell.querySelectorAll("span")]
				.filter((span) => {
					const style = getComputedStyle(span);
					if (style.position === "absolute") return false;
					const rect = span.getBoundingClientRect();
					const ellipsized =
						style.textOverflow === "ellipsis" && span.scrollWidth > span.clientWidth;
					return ellipsized || rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
				})
				.map((span) => span.textContent);
		});
		expect(cut, `${column} figures cut off`).toEqual([]);
	}
}

async function expectHeadersInPanel(panel: Locator): Promise<void> {
	const layout = await panel.getByTestId("session-insights-table").evaluate((table) => {
		const scroller = table.parentElement;
		if (!scroller) throw new Error("the table has no scroll container");
		const view = scroller.getBoundingClientRect();
		const right = view.left + scroller.clientWidth;
		const headers = [...table.querySelectorAll("thead th")];
		return {
			count: headers.length,
			sideways: scroller.scrollWidth - scroller.clientWidth,
			outside: headers
				.filter((th) => {
					const rect = th.getBoundingClientRect();
					return rect.left < view.left - 0.5 || rect.right > right + 0.5;
				})
				.map((th) => th.textContent),
			cut: headers
				.filter((th) => {
					const box = th.getBoundingClientRect();
					return [th, ...th.querySelectorAll("button, span")].some((part) => {
						const rect = part.getBoundingClientRect();
						const ellipsized =
							getComputedStyle(part).textOverflow === "ellipsis" &&
							part.scrollWidth > part.clientWidth;
						return ellipsized || rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
					});
				})
				.map((th) => th.textContent),
		};
	});
	expect(layout.count, "one header per column").toBe(10);
	expect(layout.sideways, "the table scrolls sideways").toBeLessThanOrEqual(0);
	expect(layout.outside, "headers outside the panel").toEqual([]);
	expect(layout.cut, "headers cut off").toEqual([]);
}

async function moveAwayTo(page: Page, target: Locator): Promise<void> {
	const box = await target.boundingBox();
	if (!box) throw new Error("the pointer target is not laid out");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
}

async function setInsightsEnabled(page: Page, enabled: boolean): Promise<void> {
	await openSettingsSection(page, "extensions");
	const toggle = page.getByTestId("extension-toggle-session-insights");
	if ((await toggle.getAttribute("data-active")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", String(enabled));
	await closeSettings(page);
}

test.beforeEach(() => {
	rmSync(join(E2E_DATA_DIR, "extensions", "session-insights"), { recursive: true, force: true });
});

test.afterEach(async ({ page }) => {
	if (page.isClosed()) return;
	await resetKeybindings(page);
	await setInsightsEnabled(page, true);
});

test("the palette opens Session insights, which lists the project's sessions with pi's figures and where each comes from", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	const { delegationDir } = seedInsightsSessions(workspace);
	seedExternalCwdSessions();
	try {
		await enterDefaultWorkspace(page);
		await expect(restoredChatTab(page, INSIGHTS_SESSIONS.priced.id)).toBeVisible();
		const panel = await openInsightsPanel(page, { rows: INSIGHTS_ROWS });

		await expect(panel.getByTestId("session-insights-group")).toHaveCount(0);
		await expect(panel.getByTestId("session-insights-count")).toHaveText("3 sessions");
		await expect(panel.getByTestId("session-insights-row").first()).toHaveAttribute(
			"data-session-id",
			INSIGHTS_SESSIONS.priced.id,
		);

		const priced = insightsRow(panel, INSIGHTS_SESSIONS.priced.id);
		await expect(priced).toHaveAttribute("data-workspace-state", "open");
		await expect(priced.getByTestId("session-insights-live")).toBeVisible();
		await expect(panel.getByTestId("session-insights-live")).toHaveCount(1);
		await expect(priced.getByTestId("session-insights-name")).toContainText(
			INSIGHTS_SESSIONS.priced.title,
		);
		await expect(priced.getByTestId("session-insights-tokens")).toHaveText("45.5K");
		await expect(priced.getByTestId("session-insights-cost")).toHaveText("$0.42");
		await expect(priced.getByTestId("session-insights-calls")).toHaveText("2");
		await expect(priced.getByTestId("session-insights-errors")).toHaveText("1 · 50%");
		await expect(priced.getByTestId("session-insights-subagents")).toHaveText("0");
		await expect(priced.getByTestId("session-insights-outcome")).toHaveText("—");
		await expect(priced.getByTestId("session-insights-active")).toContainText("1 min");
		await expectBadges(priced, ["approximated"]);
		await expectBadges(priced.getByTestId("session-insights-active"), ["approximated"]);

		const unpriced = insightsRow(panel, INSIGHTS_SESSIONS.unpriced.id);
		const unpricedCost = unpriced.getByTestId("session-insights-cost");
		await expect(unpricedCost).toContainText("$0");
		await expect(unpricedCost).toContainText("not recorded");
		await expect(unpricedCost).toContainText("8.9K tokens");
		await expect(unpriced.getByTestId("session-insights-tokens")).toHaveText("8.9K");
		await expect(unpriced.getByTestId("session-insights-errors")).toHaveText("0");
		await expectBadges(unpriced, ["approximated", "notRecorded"]);
		await expectBadges(unpricedCost, ["notRecorded"]);

		const delegating = insightsRow(panel, INSIGHTS_SESSIONS.delegating.id);
		await expect(delegating.getByTestId("session-insights-subagents")).toHaveText("1");
		await expect(delegating.getByTestId("session-insights-tokens")).toHaveText("1.8K");
		await expect(delegating.getByTestId("session-insights-cost")).toContainText("$0.07");
		await expect(delegating.getByTestId("session-insights-outside")).toHaveText(
			"+$0.25 subagents outside pi's total",
		);
		await expectBadges(delegating, ["approximated"]);

		for (const row of [priced, unpriced, delegating]) {
			await expectBadges(row.getByTestId("session-insights-tokens"), []);
			await expectBadges(row.getByTestId("session-insights-calls"), []);
			await expectFiguresUncut(row);
		}
		await expect(page.getByTestId("left-stack")).toHaveCount(0);
		await expect(page.getByTestId("right-stack")).toHaveCount(0);
		await expect(page.getByTestId("bottom-panel")).toHaveCount(0);
		await page.keyboard.press("Control+Shift+F12");
		await expect(page.getByTestId("left-stack")).toBeVisible();
		await expect(page.getByTestId("right-stack")).toBeVisible();
		await expect(page.getByTestId("bottom-panel")).toBeVisible();
		await expectHeadersInPanel(panel);
		await shot(page, "session-insights", "ready");

		await unpricedCost.getByRole("button").hover();
		const costFigure = page
			.locator('[data-testid="session-insights-figure"][data-metric="cost"]')
			.first();
		await expect(costFigure).toBeVisible();
		await expect(costFigure).toHaveAttribute("data-origin", "notRecorded");
		await expect(costFigure).toContainText("Not recorded");
		await expect(costFigure).toContainText("The session doesn't record this value");
		await expect(costFigure).toContainText("message[assistant].usage.cost.total");
		await shot(page, "session-insights", "tooltip-not-recorded");
		await moveAwayTo(page, panel.getByTestId("session-insights-count"));
		await expect(costFigure).toBeHidden();

		await priced.getByTestId("session-insights-tokens").getByRole("button").hover();
		const tokensFigure = page
			.locator('[data-testid="session-insights-figure"][data-metric="tokens"]')
			.first();
		await expect(tokensFigure).toBeVisible();
		await expect(tokensFigure).toHaveAttribute("data-origin", "recorded");
		await expect(tokensFigure).toContainText("Recorded by pi");
		await expect(tokensFigure).toContainText("45,500");
		await expect(tokensFigure).toContainText(
			"Input 14,000 · output 1,500 · cache read 28,000 · cache write 2,000",
		);
		await moveAwayTo(page, panel.getByTestId("session-insights-count"));
		await expect(tokensFigure).toBeHidden();

		await panel.getByTestId("session-insights-scope-all").click();
		await expect(panel.getByTestId("session-insights-row")).toHaveCount(5);
		const groups = panel.getByTestId("session-insights-group");
		await expect(groups).toHaveCount(2);
		await expect(groups.nth(0)).toHaveAttribute("data-group", `project:${workspace.projectId}`);
		await expect(groups.nth(0)).toContainText("sample-project");
		await expect(groups.nth(0)).toContainText("3 sessions");
		await expect(groups.nth(1)).toHaveAttribute("data-group", "outside");
		await expect(groups.nth(1)).toContainText("Outside ThinkRail projects");
		await expect(groups.nth(1)).toContainText("2 sessions");
		await expect(
			insightsRow(panel, "e2e-fixture-deploy-docs").getByTestId("session-insights-open-chat"),
		).toHaveCount(0);
		await expect(
			insightsRow(panel, "e2e-fixture-deploy-docs").getByTestId("session-insights-name"),
		).toContainText("deploy the docs site");
		for (const id of ["e2e-fixture-deploy-docs", "e2e-fixture-dependency-pins"])
			await expectFiguresUncut(insightsRow(panel, id));
		await shot(panel, "session-insights", "all-projects");

		await panel.getByTestId("session-insights-scope-project").click();
		await expect(panel.getByTestId("session-insights-row")).toHaveCount(3);
		await expect(panel.getByTestId("session-insights-group")).toHaveCount(0);
		await hideAuxiliaryWorkbench(page);
		await expect(priced.getByTestId("session-insights-outcome")).toBeInViewport();
		await shot(panel, "session-insights", "ready-full-width");

		await unpriced.getByTestId("session-insights-open-chat").click();
		const openedTab = restoredChatTab(page, INSIGHTS_SESSIONS.unpriced.id);
		await expect(openedTab).toContainText(INSIGHTS_SESSIONS.unpriced.title);
		await expect(openedTab).toHaveAttribute("data-active", "true");
		await expect(
			page.locator('[data-testid="chat-message"][data-role="assistant"]', {
				hasText: "Three fixes and one new setting.",
			}),
		).toBeVisible();
	} finally {
		rmSync(delegationDir, { recursive: true, force: true });
	}
});

test("turning Session insights off in Settings swaps its open tab for the disabled placeholder and drops its palette row until it is back on", async ({
	page,
}) => {
	await openFixtureProject(page);
	const toggled = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Toggled insights session",
		messages: [{ role: "user", text: "list the open issues", timestamp: 1_731_100_000_000 }],
	});
	await enterDefaultWorkspace(page);
	await expect(restoredChatTab(page, toggled.id)).toBeVisible();
	const panel = await openInsightsPanel(page, { rows: [toggled.id] });

	await setInsightsEnabled(page, false);
	const placeholder = page.getByTestId("extension-panel-disabled");
	await expect(placeholder).toBeVisible();
	await expect(placeholder).toContainText("This extension is turned off.");
	await expect(panel).toHaveCount(0);
	await placeholder.getByText("This extension is turned off.").click();
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await shot(page, "session-insights", "disabled");

	const offRow = await paletteRow(page, ">open");
	await expect(
		page.locator('[data-testid="search-row"][data-item-id="command:project.open"]'),
	).toBeVisible();
	await expect(offRow).toHaveCount(0);
	await closePalette(page);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(placeholder).toBeVisible();
	await expect(panel).toHaveCount(0);

	await placeholder.getByRole("button", { name: "Open Settings" }).click();
	await expect(page.getByTestId("settings-extensions")).toBeVisible();
	const toggle = page.getByTestId("extension-toggle-session-insights");
	await expect(toggle).toHaveAttribute("data-active", "false");
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");
	await closeSettings(page);

	await expect(placeholder).toHaveCount(0);
	await expect(panel.getByTestId("session-insights-row")).toHaveCount(1);
	await expect(panel.getByTestId("session-insights-name")).toContainText(
		"Toggled insights session",
	);
	await expect(await paletteRow(page, ">session insights")).toContainText("Open Session insights");
	await closePalette(page);
});

test("on Project Home the palette finds Session insights by what it shows, enters the project folder and opens it there", async ({
	page,
}) => {
	await openFixtureProject(page);
	const command = await paletteRow(page, ">tokens");
	await expect(command).toContainText("Open Session insights");
	await command.click();
	await expect(page.getByTestId("search-palette")).toBeHidden();
	await expect(page.getByTestId("session-insights-panel")).toBeVisible();
	await expect(page.getByTestId("left-stack")).toHaveCount(0);
	await page.keyboard.press("Control+Shift+F12");
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="extension"]', {
			hasText: "Session insights",
		}),
	).toBeVisible();
	await expect(page.getByTestId("session-insights-panel")).toBeVisible();
});

const ENTRY_SHOTS = "session-insights/entry-points";
const RAIL_ICON = "extension-rail-session-insights-sessions";

function analysisTab(page: Page, title: string): Locator {
	return page.locator('[data-testid="editor-tab"][data-kind="extension"]', { hasText: title });
}

function listTab(page: Page): Locator {
	return analysisTab(page, "Session insights");
}

async function expectAnalysisOf(page: Page, sessionId: string, title: string): Promise<void> {
	await expect(analysisTab(page, title)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("session-insights-session")).toHaveAttribute(
		"data-session-id",
		sessionId,
	);
}

/** A chat without a project whose session file holds a conversation; the reload reads its state from disk. */
async function seedProjectlessChat(page: Page, prompt: string): Promise<string> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	let sessionId: string;
	try {
		const created = await wire.request("chat.create", {});
		sessionId = created.sessionId;
		await wire.request("session.dispose", { sessionId });
		seedWorkspaceSession(created.workspace.worktreePath, {
			id: sessionId,
			messages: [
				{ role: "user", text: prompt, timestamp: Date.now() - 2_000 },
				{ role: "assistant", text: "Booked.", timestamp: Date.now() - 1_000 },
			],
		});
	} finally {
		wire.close();
	}
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("chat-item")).toHaveCount(1);
	return sessionId;
}

test("an open chat shows its analysis beside it from its header's toggle and its tab's menu; a closed one opens a tab", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	const { delegationDir } = seedInsightsSessions(workspace);
	const { priced, unpriced } = INSIGHTS_SESSIONS;
	try {
		await enterDefaultWorkspace(page);
		const chatTab = restoredChatTab(page, priced.id);
		await chatTab.click();
		const toolbar = page.getByTestId("chat-toolbar");
		await expect(toolbar.getByTestId("session-stats")).toContainText("$");
		const toggle = toolbar.getByTestId("chat-header-toggle");
		await expect(toggle).toHaveText("Session analysis");
		await expect(toggle).toHaveAttribute("data-action", "session-insights.session");
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await toggle.hover();
		await shot(toolbar, ENTRY_SHOTS, "chat-header");
		await toggle.click();
		const pane = page.getByTestId("chat-pane");
		await expect(pane).toHaveAttribute("data-pane", "session-insights.session");
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expect(chatTab).toHaveAttribute("data-active", "true");
		const beside = pane.getByTestId("session-insights-session");
		await expect(beside).toHaveAttribute("data-session-id", priced.id);
		await expect(beside.getByTestId("session-insights-session-title")).toHaveText(priced.title);
		await expect(beside.getByTestId("session-insights-session-open-chat")).toHaveCount(0);
		await expect(page.locator('[data-testid="editor-tab"][data-kind="extension"]')).toHaveCount(0);
		await shot(page, ENTRY_SHOTS, "chat-pane");

		await toggle.click();
		await expect(pane).toHaveCount(0);
		await chatTab.click({ button: "right" });
		const analyze = page.getByTestId("tab-chat-action");
		await expect(analyze).toHaveText("Analyze session");
		await shot(page, ENTRY_SHOTS, "tab-menu");
		await analyze.click();
		await expect(pane).toBeVisible();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator('[data-testid="editor-tab"][data-kind="extension"]')).toHaveCount(0);

		await pane.getByTestId("session-insights-open-as-tab").click();
		await expect(pane).toHaveCount(0);
		await expectAnalysisOf(page, priced.id, priced.title);
		await expect(page.locator('[data-testid="editor-tab"][data-kind="extension"]')).toHaveCount(1);

		await page.getByTestId("chat-history").first().click();
		const closed = page.locator(
			`[data-testid="closed-chat-row"][data-session-id="${unpriced.id}"]`,
		);
		const fromHistory = closed.getByTestId("closed-chat-action");
		await expect(fromHistory).toHaveAttribute("aria-label", `Analyze session: ${unpriced.title}`);
		await fromHistory.hover();
		await expect(page.getByRole("tooltip")).toHaveText("Analyze session");
		await shot(page, ENTRY_SHOTS, "recently-closed");
		await fromHistory.click();
		await expect(page.getByTestId("chat-history-popover")).toHaveCount(0);
		await expectAnalysisOf(page, unpriced.id, unpriced.title);
		await expect(restoredChatTab(page, unpriced.id)).toHaveCount(0);
	} finally {
		rmSync(delegationDir, { recursive: true, force: true });
	}
});

test("a chat in the Chats list offers its analysis from its ⋯ menu, and an empty chat does not", async ({
	page,
}) => {
	await openFixtureProject(page);
	const sessionId = await seedProjectlessChat(page, "book the flights to Lisbon");
	await enterDefaultWorkspace(page);
	const row = page.getByTestId("chat-item");
	await row.hover();
	await row.getByTestId("chat-menu").click();
	const analyze = page.getByTestId("chat-actions").getByTestId("chat-row-action");
	await expect(analyze).toHaveText("Analyze session");
	await shot(page, ENTRY_SHOTS, "chats-list");
	await analyze.click();
	await expectAnalysisOf(page, sessionId, "book the flights to Lisbon");
	await expect(page.getByTestId("left-stack")).toHaveCount(0);
	await page.keyboard.press("Control+Shift+F12");
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(row).toHaveAttribute("data-active", "false");

	await page.getByTestId("add-chat").click();
	await expect(page.getByTestId("chat-item")).toHaveCount(2);
	const empty = page.locator('[data-testid="chat-item"][data-active="true"]');
	await expect(empty.getByTestId("chat-title")).toHaveAttribute("data-title-source", "default");
	await expect(page.getByTestId("chat-toolbar").getByTestId("chat-header-toggle")).toHaveCount(0);
	await empty.getByTestId("chat-menu").click();
	await expect(page.getByTestId("chat-actions")).toBeVisible();
	await expect(page.getByTestId("chat-row-action")).toHaveCount(0);
	await page.keyboard.press("Escape");
});

test("the left rail's Session insights icon and its chord open the list, on Project Home and in a workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	const rail = page.getByTestId("left-layout-rail");
	const icon = rail.getByTestId(RAIL_ICON);
	const keyboard = rail.getByTestId("open-shortcuts");
	await expect(icon).toHaveAccessibleName("Session insights");
	const [iconBox, keyboardBox] = await Promise.all([icon.boundingBox(), keyboard.boundingBox()]);
	expect(iconBox && keyboardBox && iconBox.y < keyboardBox.y).toBe(true);
	await icon.hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Session insights\s*Ctrl\s*Alt\s*I/);
	await shot(page, ENTRY_SHOTS, "rail-home");
	await icon.click();
	await expect(listTab(page)).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Control+Shift+F12");
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("session-insights-panel")).toBeVisible();

	await listTab(page).getByTestId("editor-tab-close").click();
	await expect(listTab(page)).toHaveCount(0);
	await page.keyboard.press("Control+Alt+KeyI");
	await expect(listTab(page)).toHaveAttribute("data-active", "true");

	const command = await paletteRow(page, ">session insights");
	await expect(command).toContainText(/Ctrl\s*Alt\s*I/);
	await shot(page, ENTRY_SHOTS, "palette");
	await closePalette(page);
	await page.getByTestId("left-layout-rail").getByTestId("open-shortcuts").click();
	const section = page.locator(
		'[data-testid="shortcuts-section"][data-extension="session-insights"]',
	);
	const openRow = section.getByTestId("shortcuts-row").filter({ hasText: "Open Session insights" });
	await expect(openRow).toContainText(/Ctrl\s*Alt\s*I/);
	await openRow.scrollIntoViewIfNeeded();
	await shot(page, ENTRY_SHOTS, "cheatsheet");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);

	await listTab(page).getByTestId("editor-tab-close").click();
	const workbenchIcon = page.getByTestId("left-layout-rail").getByTestId(RAIL_ICON);
	await workbenchIcon.hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Session insights\s*Ctrl\s*Alt\s*I/);
	await shot(page, ENTRY_SHOTS, "rail-workspace");
	await workbenchIcon.click();
	await expect(listTab(page)).toHaveAttribute("data-active", "true");
	await listTab(page).getByTestId("editor-tab-close").click();

	await setKeybindings(page, { "session-insights.openSessions": ["Mod+Shift+KeyU"] });
	await workbenchIcon.hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Session insights\s*Ctrl\s*Shift\s*U/);
	const row = await paletteRow(page, ">session insights");
	await expect(row).toContainText(/Ctrl\s*Shift\s*U/);
	await closePalette(page);
	await page.keyboard.press("Control+Alt+KeyI");
	await expect(listTab(page)).toHaveCount(0);
	await page.keyboard.press("Control+Shift+KeyU");
	await expect(listTab(page)).toHaveAttribute("data-active", "true");
});

test("while Session insights is off, no chat, menu, rail icon or chord offers it, and all come back with it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await seedProjectlessChat(page, "plan the offsite");
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "A chat with a session file",
		messages: [{ role: "user", text: "list the open issues", timestamp: 1_731_100_000_000 }],
	});
	await enterDefaultWorkspace(page);
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]').first();
	await expect(chatTab).toBeVisible();
	const link = page.getByTestId("chat-toolbar").getByTestId("chat-header-toggle");
	const icon = page.getByTestId("left-layout-rail").getByTestId(RAIL_ICON);
	await expect(link).toBeVisible();
	await expect(icon).toBeVisible();

	await setInsightsEnabled(page, false);
	await expect(link).toHaveCount(0);
	await expect(icon).toHaveCount(0);
	await expect(page.getByTestId("left-layout-rail").getByTestId("open-shortcuts")).toBeVisible();
	await chatTab.click({ button: "right" });
	await expect(page.getByRole("menu")).toBeVisible();
	await expect(page.getByTestId("tab-chat-action")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Control+Alt+KeyI");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="extension"]')).toHaveCount(0);
	const chatRow = page.getByTestId("chat-item");
	await chatRow.getByTestId("chat-menu").click();
	await expect(page.getByTestId("chat-actions")).toBeVisible();
	await expect(page.getByTestId("chat-row-action")).toHaveCount(0);
	await page.keyboard.press("Escape");

	await setInsightsEnabled(page, true);
	await expect(link).toBeVisible();
	await expect(icon).toBeVisible();
	await chatRow.getByTestId("chat-menu").click();
	await expect(page.getByTestId("chat-row-action")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Control+Alt+KeyI");
	await expect(listTab(page)).toHaveAttribute("data-active", "true");
});

test("a session's analysis traces its calls on a shared axis, explains a failing call and opens the chat at it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	const { delegationDir } = seedInsightsSessions(workspace);
	try {
		await enterDefaultWorkspace(page);
		await expect(restoredChatTab(page, INSIGHTS_SESSIONS.priced.id)).toBeVisible();
		const panel = await openInsightsPanel(page, { rows: INSIGHTS_ROWS });
		await hideAuxiliaryWorkbench(page);

		await insightsRow(panel, INSIGHTS_SESSIONS.priced.id)
			.getByTestId("session-insights-open-analysis")
			.click();
		const tab = page.locator('[data-testid="editor-tab"][data-kind="extension"]', {
			hasText: INSIGHTS_SESSIONS.priced.title,
		});
		await expect(tab).toBeVisible();
		await expect(tab).toHaveAttribute("data-active", "true");
		const session = page.getByTestId("session-insights-session");
		await expect(session).toHaveAttribute("data-session-id", INSIGHTS_SESSIONS.priced.id);
		await expect(session.getByTestId("session-insights-session-title")).toHaveText(
			INSIGHTS_SESSIONS.priced.title,
		);
		await expect(session.getByTestId("session-insights-session-tokens")).toContainText("45.5K");
		await expect(session.getByTestId("session-insights-session-cost")).toContainText("$0.42");
		await expect(session.getByTestId("session-insights-session-models")).toHaveText(
			"claude-sonnet-4-5",
		);
		await expect(session.getByTestId("session-insights-session-models")).toHaveAttribute(
			"aria-label",
			/anthropic\/claude-sonnet-4-5/,
		);
		await expect(session.getByTestId("session-insights-section-overview")).toHaveAttribute(
			"aria-selected",
			"true",
		);

		await session.getByTestId("session-insights-section-trace").click();
		const trace = session.getByTestId("trace-explorer");
		const rows = trace.getByTestId("trace-row");
		await expect(rows).toHaveCount(5);
		const repeat = trace.getByTestId("trace-repeat-badge");
		await expect(repeat).toHaveText("×2");
		await expect(trace.getByTestId("trace-filter-repeats")).toContainText("Repeats · 1");
		await expect(trace.getByTestId("trace-filter-retries")).toContainText("Retries · 1");
		await repeat.click();
		await expect(rows).toHaveCount(7);
		await expect(rows.nth(6)).toHaveAttribute("data-kind", "mark");
		await expect(rows.nth(6)).toContainText("Thinking level");
		await expect(rows.nth(0)).toHaveAttribute("data-kind", "mark");
		await expect(rows.nth(1)).toHaveAttribute("data-kind", "turn");
		await expect(rows.nth(1)).toContainText("refactor the retry helper");
		const failing = trace.locator('[data-testid="trace-row"][data-kind="tool"][data-error="true"]');
		await expect(failing).toHaveCount(1);
		await expect(failing).toContainText("bun test retry");
		await expect(failing.getByTestId("trace-error-badge")).toHaveText("exit 1");
		await expect(trace.getByTestId("trace-canvas")).toBeVisible();
		await expect(trace.getByTestId("trace-gantt")).toHaveAttribute("aria-hidden", "true");
		await expect(trace.getByTestId("trace-filter-errors")).toContainText("Errors · 1");
		await shot(page, "session-insights-s3", "trace");

		await failing.click();
		const details = trace.getByTestId("trace-details");
		await expect(details).toHaveAttribute("data-event-id", /^tool:/);
		await expect(details.getByTestId("details-title")).toContainText("bash");
		await expect(details.getByTestId("details-status")).toHaveText("failed");
		await expect(details.getByTestId("details-tab-result")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		const result = details.getByTestId("details-result");
		await expect(result).toContainText("1 test failed: retries forever");
		await expect(result).toContainText("Command exited with code 1");
		await expect(details.getByTestId("details-duration")).toHaveText("15 s");
		await expect(details.getByTestId("details-next")).toContainText("claude-sonnet-4-5");
		await shot(page, "session-insights-s3", "details-result");

		await details.getByTestId("details-tab-input").click();
		await expect(details.getByTestId("details-rendered").getByTestId("tool-bash")).toContainText(
			"bun test retry",
		);
		await details.getByTestId("details-view-json").click();
		const input = details.getByTestId("details-input");
		await expect(input).toContainText("command");
		await expect(input).toContainText('"bun test retry"');
		await shot(page, "session-insights-s3", "details-input-json");

		await trace.getByTestId("trace-filter-errors").click();
		await expect(rows).toHaveCount(3);
		await trace.getByTestId("trace-filter-all").click();
		await expect(rows).toHaveCount(7);

		await trace.getByTestId("trace-search").fill("retries forever");
		await expect(trace.getByTestId("trace-search-count")).toHaveText("1/1");
		await trace.getByTestId("trace-search").press("Escape");
		await expect(trace.getByTestId("trace-tree")).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(details.getByTestId("details-title")).toContainText("claude-sonnet-4-5");
		await page.keyboard.press("ArrowUp");
		await expect(details.getByTestId("details-status")).toHaveText("failed");
		await page.keyboard.press("z");
		await expect(trace.getByTestId("trace-tree")).toBeFocused();
		await expect(page.getByTestId("hint-mode")).toHaveCount(0);
		await page.keyboard.press("f");
		await expect(page.getByTestId("hint-mode")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("hint-mode")).toHaveCount(0);
		await expect(trace.getByTestId("trace-tree")).toBeFocused();

		await details.getByTestId("details-open-chat").click();
		const chatTab = restoredChatTab(page, INSIGHTS_SESSIONS.priced.id);
		await expect(chatTab).toHaveAttribute("data-active", "true");
		const flashed = page.locator('[data-chat-row-id="activity:bash-1"] [data-flash]');
		await expect(flashed).toBeVisible();
		await expect(flashed).toContainText("bun test retry");
		await shot(page, "session-insights-s3", "open-in-chat");

		await page
			.locator('[data-testid="editor-tab"][data-kind="extension"]', { hasText: "Session insights" })
			.click();
		await insightsRow(panel, INSIGHTS_SESSIONS.delegating.id)
			.getByTestId("session-insights-open-analysis")
			.click();
		const delegating = page.getByTestId("session-insights-session");
		await expect(delegating).toHaveAttribute("data-session-id", INSIGHTS_SESSIONS.delegating.id);
		await delegating.getByTestId("session-insights-section-trace").click();
		const spawned = delegating.locator('[data-testid="trace-row"][data-kind="subagent"]');
		await expect(spawned).toContainText("scout");
		await expect(spawned).toContainText("audit the retry paths");
		await expect(spawned).toContainText("completed");
		await spawned.click();
		await expect(delegating.getByTestId("details-tab-subagent")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(delegating.getByTestId("details-duration")).toHaveText("≈ 50 s");
		await shot(page, "session-insights-s3", "trace-subagent");
	} finally {
		rmSync(delegationDir, { recursive: true, force: true });
	}
});

test("a failed call folded into a repeat shows for a jump to it and for the Errors filter", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedRepeatSession(workspace);
	await enterDefaultWorkspace(page);
	const panel = await openInsightsPanel(page, { rows: [REPEAT_SESSION.id] });
	await hideAuxiliaryWorkbench(page);

	const search = panel.getByTestId("session-insights-search");
	await search.fill("tool:bash error:yes");
	const view = panel.getByTestId("insights-search-view");
	await expect(view.getByTestId("insights-search-status")).toHaveAttribute("data-phase", "done");
	const hit = view.getByTestId("insights-search-hit");
	await expect(hit).toHaveCount(1);
	const eventId = await hit.getAttribute("data-event-id");
	await hit.click();
	const session = page.getByTestId("session-insights-session");
	await expect(session).toHaveAttribute("data-session-id", REPEAT_SESSION.id);
	const trace = session.getByTestId("trace-explorer");
	const selected = trace.locator('[data-testid="trace-row"][data-selected="true"]');
	await expect(selected).toHaveAttribute("data-event-id", eventId ?? "");
	await expect(selected).toHaveAttribute("data-error", "true");
	await expect(trace.getByTestId("trace-details").getByTestId("details-status")).toHaveText(
		"failed",
	);
	const badge = trace.getByTestId("trace-repeat-badge");
	await expect(badge).toHaveText("×2");
	await expect(badge).toHaveAttribute("data-open", "true");

	const failing = trace.locator('[data-testid="trace-row"][data-kind="tool"][data-error="true"]');
	await badge.click();
	await expect(badge).toHaveAttribute("data-open", "false");
	await expect(failing).toHaveCount(0);
	await expect(selected).toContainText("bun test retry");
	await expect(selected).not.toHaveAttribute("data-error", "true");

	await trace.getByTestId("trace-filter-errors").click();
	await expect(failing).toHaveCount(1);
	await expect(failing).toContainText("bun test retry");
	await expect(trace.getByTestId("trace-row")).toHaveCount(3);
	await trace.getByTestId("trace-filter-all").click();
	await expect(failing).toHaveCount(0);
});

test("turn cards, the actor timeline and the day view read one session's turns and a day's sessions", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedTimelineSessions(workspace);
	await enterDefaultWorkspace(page);
	await expect(restoredChatTab(page, TIMELINE_SESSIONS.docs.id)).toBeVisible();
	const panel = await openInsightsPanel(page, {
		rows: [TIMELINE_SESSIONS.busy.id, TIMELINE_SESSIONS.docs.id],
	});
	await hideAuxiliaryWorkbench(page);

	await insightsRow(panel, TIMELINE_SESSIONS.busy.id)
		.getByTestId("session-insights-open-analysis")
		.click();
	const session = page.getByTestId("session-insights-session");
	await expect(session).toHaveAttribute("data-session-id", TIMELINE_SESSIONS.busy.id);
	await session.getByTestId("session-insights-section-trace").click();
	await session.getByTestId("session-insights-trace-mode-turns").click();
	const cards = session.getByTestId("turn-card");
	await expect(cards).toHaveCount(3);
	await expect(cards.nth(0)).toContainText("plan the timeline view");
	await expect(cards.nth(0)).toHaveAttribute("data-expanded", "true");
	await expect(cards.nth(0).getByTestId("turn-figures")).toContainText("1 error");
	await expect(cards.nth(0).getByTestId("turn-figures")).toContainText("waited for you 3 min");
	await expect(cards.nth(2)).toHaveAttribute("data-trigger", "background");
	await expect(cards.nth(2).getByTestId("turn-trigger")).toHaveText("background command finished");
	await expect(session.getByTestId("turns-filter-errors")).toContainText("With errors · 1");
	await shot(page, "session-insights/s4", "turns");

	await cards.nth(1).getByTestId("turn-card-toggle").click();
	await expect(cards.nth(1)).toHaveAttribute("data-expanded", "true");
	const details = session.getByTestId("trace-details");
	await expect(details.getByTestId("details-prompt")).toContainText(
		"now run the build in the background",
	);
	const failing = cards.nth(0).locator('[data-testid="turn-step-tool"]', { hasText: "bun test" });
	await failing.click();
	await expect(failing).toHaveAttribute("aria-pressed", "true");
	await expect(details.getByTestId("details-title")).toContainText("bash");
	await expect(details.getByTestId("details-status")).toHaveText("failed");
	await expect(details.getByTestId("details-result")).toContainText("1 test failed");
	await shot(page, "session-insights/s4", "turns-step-details");

	await session.getByTestId("session-insights-trace-mode-tree").click();
	const selectedRow = session.locator('[data-testid="trace-row"][data-selected="true"]');
	await expect(selectedRow).toHaveAttribute("data-kind", "tool");
	await expect(selectedRow).toContainText("bun test timeline");

	await session.getByTestId("session-insights-trace-mode-timeline").click();
	const timeline = session.getByTestId("timeline-view");
	await expect(timeline.getByTestId("timeline-canvas")).toBeVisible();
	await expect(timeline.getByTestId("timeline-axis")).toBeVisible();
	const gapLabels = timeline.getByTestId("timeline-gap-label");
	await expect(gapLabels.first()).toBeAttached();
	await expect(
		timeline.locator('[data-testid="timeline-gap-label"][data-cause="user"]').first(),
	).toContainText("waited for you");
	await expect(
		timeline.locator('[data-testid="timeline-gap-label"][data-cause="background"]'),
	).toContainText("waited for background work");
	await expect(timeline.getByTestId("timeline-waits")).toContainText("You");
	await expect(timeline.getByTestId("trace-details").getByTestId("details-title")).toContainText(
		"bash",
	);
	await shot(page, "session-insights/s4", "timeline");
	await timeline.getByTestId("timeline-axis-steps").click();
	await expect(timeline.getByTestId("timeline-gap-label")).toHaveCount(0);
	await shot(page, "session-insights/s4", "timeline-steps");

	await page
		.locator('[data-testid="editor-tab"][data-kind="extension"]', { hasText: "Session insights" })
		.click();
	await panel.getByTestId("session-insights-tab-days").click();
	const day = panel.getByTestId("day-view");
	await expect(day).toHaveAttribute("data-day", TIMELINE_DAY.key);
	const dayRows = day.getByTestId("day-row");
	await expect(dayRows).toHaveCount(2);
	await expect(dayRows.nth(0)).toHaveAttribute("data-session-id", TIMELINE_SESSIONS.busy.id);
	await expect(day.getByTestId("day-title")).toContainText("2 sessions");
	await expect(day.getByTestId("day-canvas")).toBeVisible();
	await shot(page, "session-insights/s4", "day");

	await day
		.locator(`[data-testid="day-row"][data-session-id="${TIMELINE_SESSIONS.docs.id}"]`)
		.click();
	const opened = page.getByTestId("session-insights-session");
	await expect(opened).toHaveAttribute("data-session-id", TIMELINE_SESSIONS.docs.id);
	await expect(opened.getByTestId("session-insights-session-title")).toHaveText(
		TIMELINE_SESSIONS.docs.title,
	);
});

test("subagent waves, the plan and skill bands, and errors as recovery chains explain one session", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	const { delegationDir } = seedPlanSessions(workspace);
	try {
		await enterDefaultWorkspace(page);
		await expect(restoredChatTab(page, PLAN_SESSIONS.release.id)).toBeVisible();
		const panel = await openInsightsPanel(page, { rows: [PLAN_SESSIONS.release.id] });
		await hideAuxiliaryWorkbench(page);
		await insightsRow(panel, PLAN_SESSIONS.release.id)
			.getByTestId("session-insights-open-analysis")
			.click();
		const session = page.getByTestId("session-insights-session");
		await expect(session).toHaveAttribute("data-session-id", PLAN_SESSIONS.release.id);
		await session.getByTestId("session-insights-section-trace").click();
		const trace = session.getByTestId("trace-explorer");

		const planBand = trace.getByTestId("trace-band-plan");
		await expect(planBand).toHaveText("Plan · 3 steps");
		await expect(trace.getByTestId("trace-band-skills")).toHaveText("Skills · 1");
		await expect(trace.getByTestId("trace-filter-retries")).toContainText("Retries · 1");
		await planBand.click();
		await page
			.getByTestId("trace-band-plan-item")
			.filter({ hasText: "1. Bump the version" })
			.click();
		await expect(trace.getByTestId("trace-selection")).toContainText("1. Bump the version");
		await expect(trace.getByTestId("trace-focus")).toHaveAttribute("aria-pressed", "true");
		const lint = trace.locator('[data-testid="trace-row"][data-kind="tool"]', {
			hasText: "bunx biome check src/version.ts",
		});
		await expect(lint).not.toHaveAttribute("data-dimmed", "true");
		await expect(
			trace.locator('[data-testid="trace-row"][data-dimmed="true"]').first(),
		).toBeVisible();
		await shot(page, "session-insights/s5", "trace-plan-focus");
		await trace.getByTestId("trace-focus").click();
		await trace.getByTestId("trace-filter-all").click();
		await trace.getByTestId("trace-tree").focus();
		await page.keyboard.press("r");
		await expect(trace.locator('[data-testid="trace-row"][data-selected="true"]')).toContainText(
			"bunx biome check src/version.ts",
		);
		await page.keyboard.press("r");
		await expect(trace.locator('[data-testid="trace-row"][data-selected="true"]')).toContainText(
			"bunx biome check --write src/version.ts",
		);
		await setKeybindings(page, { "session-insights.previousRetry": ["KeyT"] });
		await expect(trace.getByTestId("trace-legend")).toContainText("R/T retries");
		await trace.getByTestId("trace-tree").focus();
		await page.keyboard.press("Shift+R");
		await expect(trace.locator('[data-testid="trace-row"][data-selected="true"]')).toContainText(
			"bunx biome check --write src/version.ts",
		);
		await page.keyboard.press("t");
		await expect(trace.locator('[data-testid="trace-row"][data-selected="true"]')).toContainText(
			"bunx biome check src/version.ts",
		);
		await resetKeybindings(page);

		const spawned = trace.locator('[data-testid="trace-row"][data-kind="subagent"]');
		await expect(spawned).toHaveCount(2);
		await expect(spawned.nth(0)).toContainText("reviewer");
		await expect(spawned.nth(0)).toContainText("Area: the changelog wording");
		await spawned.nth(0).locator("[data-twisty]").click();
		const nested = trace.locator(
			`[data-testid="trace-row"][data-event-id^="child:${PLAN_SESSIONS.changelog.id}/"]`,
		);
		await expect(nested.first()).toBeVisible();
		await expect(nested.filter({ hasText: "CHANGELOG.md" })).toHaveCount(1);
		await spawned.nth(0).click();
		const details = trace.getByTestId("trace-details");
		await expect(details.getByTestId("details-tab-subagent")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		const tab = details.getByTestId("subagent-tab");
		await expect(tab.getByTestId("subagent-why")).toContainText("Area: the changelog wording");
		await expect(tab.getByTestId("subagent-rationale")).toContainText(
			"I'm spinning up two reviewers",
		);
		await expect(tab.getByTestId("subagent-what")).toContainText(
			"The changelog wording is consistent.",
		);
		await expect(tab.getByTestId("subagent-consumed")).toBeVisible();
		await expect(tab.getByTestId("subagent-sibling")).toHaveCount(2);
		await expect(tab.getByTestId("subagent-activity")).toBeVisible();
		await shot(page, "session-insights/s5", "trace-subagent");

		await session.getByTestId("session-insights-section-subagents").click();
		const waves = session.getByTestId("subagent-wave");
		await expect(waves).toHaveCount(1);
		await expect(waves.getByTestId("subagent-lane")).toHaveCount(2);
		await expect(waves.getByTestId("subagent-wave-why")).toContainText(
			"I'm spinning up two reviewers",
		);
		await expect(session.getByTestId("subagents-chips")).toContainText("reviewer ×2");
		await expect(session.getByTestId("subagents-chips")).toContainText("at most 2 in parallel");
		await shot(page, "session-insights/s5", "subagents");
		await waves
			.locator(`[data-testid="subagent-lane"][data-child-id="${PLAN_SESSIONS.version.id}"]`)
			.click();
		await expect(
			session.locator('[data-testid="trace-row"][data-selected="true"]'),
		).toHaveAttribute("data-kind", "subagent");
		await expect(session.getByTestId("subagent-why")).toContainText("Area: the version bump");

		await session.getByTestId("session-insights-section-errors").click();
		const chain = session.locator('[data-testid="errors-chain"][data-outcome="recovered"]');
		await expect(chain).toHaveCount(1);
		await expect(session.getByTestId("errors-tool-row")).toHaveAttribute("data-tool", "bash");
		await chain.click();
		const detail = session.getByTestId("errors-detail");
		await expect(detail.getByTestId("errors-attempt")).toHaveCount(2);
		await expect(detail.getByTestId("errors-diff")).toContainText("--write");
		await expect(detail.locator('[data-testid="errors-diff"] [data-op="added"]')).toContainText(
			"--write",
		);
		await expect(detail.getByTestId("errors-between")).toContainText("edit");
		await expect(detail.getByTestId("errors-cluster")).toContainText(
			"Forbidden non-null assertion",
		);
		await shot(page, "session-insights/s5", "errors");
		await detail.getByTestId("errors-show-in-trace").click();
		await expect(session.getByTestId("trace-selection")).toContainText("Chain #1");
		await expect(session.locator('[data-testid="trace-row"][data-selected="true"]')).toContainText(
			"bunx biome check src/version.ts",
		);

		await session.getByTestId("session-insights-section-trace").click();
		await session.getByTestId("session-insights-trace-mode-turns").click();
		const card = session.getByTestId("turn-card").first();
		await expect(card.getByTestId("turn-plan-badge")).toContainText("3 steps · 2 done");
		await expect(card.getByTestId("turn-skill-badge")).toHaveText("todos");
		await shot(page, "session-insights/s5", "turns-badges");

		await session.getByTestId("session-insights-trace-mode-timeline").click();
		const timeline = session.getByTestId("timeline-view");
		await expect(timeline.getByTestId("timeline-plan")).toHaveAttribute("aria-pressed", "true");
		await timeline.getByTestId("timeline-plan-pick").click();
		await page
			.getByTestId("timeline-plan-pick-item")
			.filter({ hasText: "2. Write the changelog" })
			.click();
		await expect(timeline.getByTestId("timeline-plan-pick")).toContainText(
			"2. Write the changelog",
		);
		await shot(page, "session-insights/s5", "timeline-plan");
	} finally {
		rmSync(delegationDir, { recursive: true, force: true });
	}
});

test("context and cache, why a session was expensive and its files explain one session", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedContextSession(workspace);
	await enterDefaultWorkspace(page);
	await expect(restoredChatTab(page, CONTEXT_SESSIONS.refactor.id)).toBeVisible();
	const panel = await openInsightsPanel(page, { rows: [CONTEXT_SESSIONS.refactor.id] });
	await hideAuxiliaryWorkbench(page);
	await insightsRow(panel, CONTEXT_SESSIONS.refactor.id)
		.getByTestId("session-insights-open-analysis")
		.click();
	const session = page.getByTestId("session-insights-session");
	await expect(session).toHaveAttribute("data-session-id", CONTEXT_SESSIONS.refactor.id);

	await session.getByTestId("session-insights-section-cost").click();
	await expect(session.getByTestId("cost-context-cost").getByTestId("cost-view")).toBeVisible();
	const context = session.getByTestId("cost-context-context").getByTestId("context-view");
	await expect(context.getByTestId("context-chart")).toHaveAttribute("data-calls", "15");
	await expect(context.getByTestId("context-chart")).toHaveAttribute("data-misses", "4");
	await expect(context.getByTestId("context-cliff")).toHaveText(
		/^compaction 39\.9K → 9\.5K \(−\d+%\)$/,
	);
	await expect(context.getByTestId("context-switch")).toHaveText("→ openai/gpt-5");
	const misses = context.getByTestId("context-miss");
	await expect(misses).toHaveCount(4);
	for (const cause of ["systemPrompt", "modelChange", "pause", "compaction"])
		await expect(
			context.locator(`[data-testid="context-miss"] [data-cause="${cause}"]`),
		).toHaveCount(1);
	await expect(context.getByTestId("context-call")).toBeVisible();
	await expect(context.getByTestId("context-waffle")).toBeVisible();
	await shot(page, "session-insights/s6", "context");

	await misses.first().getByRole("button").click();
	await expect(context.getByTestId("context-call")).toContainText("Model call #10");
	await expect(context.getByTestId("context-call-miss")).toContainText("system prompt changed");
	await context.getByTestId("context-open-diff").click();
	const diff = context.getByTestId("request-diff");
	await expect(diff).toContainText("Request #10");
	await expect(diff).toContainText("against #9");
	await expect(
		diff.locator('[data-testid="request-check"][data-cause="systemPrompt"]'),
	).toHaveAttribute("data-found", "true");
	await expect(diff.locator('[data-testid="request-check"][data-cause="pause"]')).toHaveAttribute(
		"data-found",
		"false",
	);
	const skills = diff.locator('[data-testid="request-section"][data-status="changed"]');
	await expect(skills).toContainText("skills");
	await expect(skills.locator('[data-op="added"]')).toContainText("docs-sync");
	await expect(diff.locator('[data-testid="request-message"][data-state="new"]')).toHaveCount(2);
	await expect(diff.getByTestId("request-miss")).toContainText("the system prompt section skills");
	await expect(context.getByTestId("request-row")).toHaveCount(15);
	await expect(context.locator('[data-testid="request-row"][aria-pressed="true"]')).toHaveAttribute(
		"data-miss",
		"true",
	);
	await shot(page, "session-insights/s6", "request-diff");

	await session.getByTestId("cost-context-cost").scrollIntoViewIfNeeded();
	const cost = session.getByTestId("cost-view");
	await expect(cost.getByTestId("cost-diagnosis")).toHaveAttribute("data-kind", "cacheRewrites");
	await expect(cost.getByTestId("cost-diagnosis")).toContainText(
		"Expensive because of cache rewrites: 3 calls wrote a large context to the cache again",
	);
	await expect(cost.getByTestId("cost-moment").first()).toHaveAttribute("data-rank", "1");
	await expect(cost.getByTestId("cost-spike")).toHaveCount(3);
	await expect(cost.getByTestId("cost-spike-cause").first()).toBeVisible();
	await shot(page, "session-insights/s6", "why-expensive");
	const topCall = cost.getByTestId("cost-moment").first().getByTestId("cost-moment-call");
	const callText = (await topCall.textContent()) ?? "";
	await topCall.click();
	await expect(session.locator('[data-testid="trace-row"][data-selected="true"]')).toHaveAttribute(
		"data-kind",
		"llm",
	);
	expect(callText).toMatch(/^call #\d+ · \$/);

	await session.getByTestId("session-insights-section-files").click();
	const files = session.getByTestId("files-view");
	const parser = files.locator('[data-testid="files-row"][data-path="src/parser.ts"]');
	await expect(parser).toHaveAttribute("data-rework", "true");
	await expect(parser.getByTestId("files-rework")).toHaveText("5×");
	await expect(parser.getByTestId("files-failed")).toHaveCount(1);
	await expect(
		files.locator('[data-testid="files-row"][data-path="docs/parser.md"]'),
	).toBeVisible();
	await parser.getByRole("button").first().click();
	const detail = files.getByTestId("files-detail");
	await expect(detail).toHaveAttribute("data-path", "src/parser.ts");
	await expect(detail.getByTestId("files-diff")).toHaveCount(5);
	await expect(detail.getByTestId("files-diff").first()).toContainText("+const next0 = 0;");
	await expect(detail.locator('[data-testid="files-touch"][data-failed="true"]')).toHaveCount(1);
	await expect(detail.getByTestId("files-open")).toBeEnabled();
	await shot(page, "session-insights/s6", "files");
	const readme = files.locator('[data-testid="files-row"][data-path="README.md"]');
	await readme.getByRole("button").first().click();
	await expect(files.getByTestId("files-detail")).toHaveAttribute("data-path", "README.md");
	await files.getByTestId("files-open").click();
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]').filter({ hasText: "README.md" }),
	).toBeVisible();
});

test("statistics find a failing command and unused skills, chart usage by day and rank the hottest files", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedStatsSessions(workspace);
	await enterDefaultWorkspace(page);
	await expect(restoredChatTab(page, STATS_SESSIONS.bridge.id)).toBeVisible();
	const panel = await openInsightsPanel(page, { rows: STATS_ROWS });
	await hideAuxiliaryWorkbench(page);

	await panel.getByTestId("session-insights-tab-insights").click();
	const stats = panel.getByTestId("stats-view");
	const findings = stats.getByTestId("findings-view");
	await expect(findings).toBeVisible();
	await expect(stats.getByTestId("stats-progress")).toHaveCount(0);
	const failing = findings.locator('[data-testid="finding-card"][data-rule="commandFailing"]');
	await expect(failing).toHaveCount(1);
	await expect(failing).toContainText("“bun run lint” fails systematically");
	await expect(failing.getByTestId("finding-why")).toContainText(
		/Failed in 3 of 6 runs \(50%, 95% Wilson interval \d+%–\d+%\) in 2 sessions/,
	);
	await expect(failing.getByTestId("finding-rate")).toBeVisible();
	await expect(failing.getByTestId("finding-quote")).toContainText("Unexpected any");
	await expect(failing.getByTestId("finding-worked").locator('[data-op="added"]')).toContainText(
		"--fix",
	);
	const never = findings.locator('[data-testid="finding-card"][data-rule="skillNeverLoaded"]');
	await expect(never).toContainText("2 skills were never loaded");
	await expect(never.getByTestId("finding-name")).toHaveText(["deploy-docs", "release-notes"]);
	await expect(findings.locator('[data-testid="finding-card"][data-rule="rework"]')).toContainText(
		"src/parser.ts",
	);
	await expect(
		findings.locator('[data-testid="finding-card"][data-rule="repeatedInstruction"]'),
	).toContainText("Run the linters and the tests before you tell me the task is done.");
	await shot(panel, "session-insights/s7", "findings");

	const rework = findings.locator('[data-testid="finding-card"][data-rule="rework"]');
	await rework.getByTestId("finding-hide").click();
	await expect(rework).toHaveCount(0);
	await findings.getByTestId("findings-show-hidden").click();
	await expect(rework).toHaveAttribute("data-hidden", "true");
	await rework.getByTestId("finding-hide").click();
	await expect(rework).toHaveAttribute("data-hidden", "false");

	await failing.getByTestId("finding-show-sessions").click();
	await expect(panel.getByTestId("session-insights-filter")).toContainText(
		"“bun run lint” fails systematically · 2 sessions",
	);
	await expect(panel.getByTestId("session-insights-row")).toHaveCount(2);
	await expect(insightsRow(panel, STATS_SESSIONS.bridge.id)).toHaveCount(0);
	await shot(panel, "session-insights/s7", "show-sessions");
	await panel.getByTestId("session-insights-filter-clear").click();
	await expect(panel.getByTestId("session-insights-row")).toHaveCount(3);

	await panel.getByTestId("session-insights-tab-insights").click();
	await stats.getByTestId("stats-section-usage").click();
	const usage = stats.getByTestId("usage-view");
	await expect(usage.getByTestId("usage-chart")).toHaveAttribute("data-days", "3");
	await expect(usage.getByTestId("usage-series")).toHaveCount(2);
	await expect(usage.getByTestId("usage-markers")).toContainText("claude-bridge/claude-sonnet-4-5");
	const models = usage.getByTestId("usage-table-models");
	await expect(models.getByTestId("usage-row")).toHaveCount(2);
	await expect(
		models.locator('[data-testid="usage-row"][data-name="claude-bridge/claude-sonnet-4-5"]'),
	).toContainText("$0 · not recorded");
	await usage.getByTestId("usage-metric-tokens").click();
	await shot(panel, "session-insights/s7", "usage");
	await usage.getByTestId("usage-tab-commands").click();
	const lint = usage.locator('[data-testid="usage-row"][data-name="bun run lint"]');
	await expect(lint.getByTestId("usage-tool-errors")).toHaveText("3");
	await lint.getByTestId("usage-row-name").click();
	await expect(panel.getByTestId("session-insights-row")).toHaveCount(2);
	await panel.getByTestId("session-insights-filter-clear").click();

	await panel.getByTestId("session-insights-tab-insights").click();
	await stats.getByTestId("stats-section-hotspots").click();
	const hotspots = stats.getByTestId("hotspots-view");
	const parser = hotspots.locator('[data-testid="hotspot-row"][data-path="src/parser.ts"]');
	await expect(parser).toHaveAttribute("data-action", "split");
	await expect(parser).toHaveAttribute("data-rework", "true");
	await expect(parser.getByTestId("hotspot-touches")).toHaveText("12");
	await parser.getByTestId("hotspot-action").click();
	const detail = hotspots.getByTestId("hotspot-detail");
	await expect(detail).toContainText("Split such a task into steps with a check after each");
	await expect(detail.getByTestId("hotspot-rule")).toContainText(
		"Rule: 10 or more changes in one session → split the task.",
	);
	await expect(detail.getByTestId("hotspot-open-file")).toBeEnabled();
	await shot(panel, "session-insights/s7", "hotspots");
	await hotspots.getByTestId("hotspots-view-tree").click();
	const tree = hotspots.getByTestId("heat-tree");
	const parserRow = tree.locator('[data-testid="heat-file"][data-path="src/parser.ts"]');
	await expect(parserRow.getByTestId("heat-rework")).toContainText("⟳10");
	await expect(tree.locator('[data-testid="heat-dir"][data-path="src"]')).toBeVisible();
	await parserRow.click();
	await expect(tree.getByTestId("hotspot-detail")).toHaveAttribute("data-path", "src/parser.ts");
	await shot(panel, "session-insights/s7", "heat-tree");

	await panel.getByTestId("session-insights-scope-all").click();
	await expect(tree.getByTestId("heat-project")).toHaveCount(2);
	await shot(panel, "session-insights/s7", "heat-tree-all-projects");

	await stats.getByTestId("stats-section-findings").click();
	const link = findings
		.locator('[data-testid="finding-card"][data-rule="commandFailing"]')
		.getByTestId("finding-session")
		.first();
	await link.click();
	const session = page.getByTestId("session-insights-session");
	await expect(session).toHaveAttribute("data-session-id", STATS_SESSIONS.second.id);
	await expect(session.locator('[data-testid="trace-row"][data-selected="true"]')).toHaveAttribute(
		"data-kind",
		"tool",
	);
});

test("action sequences, a slice comparison by model and a step-aligned diff of two sessions", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedSequenceSessions(workspace);
	await enterDefaultWorkspace(page);
	const [first] = SEQUENCE_SESSIONS.sonnet;
	const [other] = SEQUENCE_SESSIONS.gpt;
	await expect(restoredChatTab(page, SEQUENCE_SESSIONS.sonnet[3].id)).toBeVisible();
	const panel = await openInsightsPanel(page, {
		rows: [...SEQUENCE_SESSIONS.sonnet, ...SEQUENCE_SESSIONS.gpt].map((session) => session.id),
	});
	await hideAuxiliaryWorkbench(page);

	await panel.getByTestId("session-insights-tab-insights").click();
	const stats = panel.getByTestId("stats-view");
	await stats.getByTestId("stats-section-sequences").click();
	const sequences = stats.getByTestId("sequences-view");
	await expect(stats.getByTestId("stats-progress")).toHaveCount(0);
	await expect(sequences.getByTestId("sequences-scope")).toContainText(
		"7 sessions with calls · 44 calls",
	);
	const loop = sequences.locator(
		'[data-testid="sequence-cell"][data-source="read"][data-target="read"]',
	);
	await expect(loop).toHaveAttribute("data-loop", "true");
	await loop.click();
	const detail = sequences.getByTestId("sequence-detail");
	await expect(detail).toHaveAttribute("data-source", "read");
	await expect(detail.getByTestId("sequence-session")).toHaveCount(4);
	await expect(
		detail.getByTestId("sequence-example-step").filter({ hasText: "src/date.test.ts" }),
	).toHaveAttribute("data-pair", "true");
	await shot(panel, "session-insights/s8", "sequences-matrix");

	await sequences.getByTestId("sequences-view-map").click();
	const map = sequences.getByTestId("process-map");
	await expect(map).toBeVisible();
	await expect(map.locator(".react-flow__node")).toHaveCount(5);
	await expect(map.locator('[data-testid="process-edge"][data-loop]')).toHaveCount(1);
	await expect(sequences.getByTestId("sequence-chain").first()).toBeVisible();
	await shot(panel, "session-insights/s8", "sequences-map");

	await sequences.getByTestId("sequences-view-errors").click();
	const errors = sequences.getByTestId("sequence-errors");
	await expect(
		errors.locator('[data-testid="sequence-flow-outcome"][data-key="recovered"]'),
	).toContainText("recovered within 3 steps");
	await expect(
		errors.locator('[data-testid="sequence-failing-row"][data-key="bun test date"]'),
	).toContainText("4");
	await expect(errors.getByTestId("sequence-flow-example")).toContainText("bun test date");
	await shot(panel, "session-insights/s8", "sequences-errors");

	await stats.getByTestId("stats-section-ab").click();
	const compare = stats.getByTestId("compare-view");
	await expect(compare).toHaveAttribute("data-by", "model");
	await expect(compare.getByTestId("compare-side-a")).toContainText(SEQUENCE_MODELS.sonnet);
	await expect(compare.getByTestId("compare-side-b")).toContainText(SEQUENCE_MODELS.gpt);
	const calls = compare.locator('[data-testid="compare-row"][data-metric="toolCalls"]');
	await expect(calls).toHaveAttribute("data-verdict", "same");
	await expect(calls.getByTestId("compare-verdict")).toHaveText("not distinguishable");
	const failed = compare.locator('[data-testid="compare-row"][data-metric="failedShare"]');
	await expect(failed).toHaveAttribute("data-verdict", "better");
	await expect(failed.getByTestId("compare-range")).toContainText(/95%: −\d/);
	await expect(failed.getByTestId("compare-interval")).toBeVisible();
	await expect(compare.getByTestId("compare-sessions")).toHaveAttribute(
		"data-metric",
		"failedShare",
	);
	await shot(panel, "session-insights/s8", "compare");

	await panel.getByTestId("session-insights-tab-sessions").click();
	await insightsRow(panel, first.id).getByTestId("session-insights-pick").click();
	await expect(panel.getByTestId("session-insights-selection-bar")).toContainText(first.title);
	await insightsRow(panel, other.id).getByTestId("session-insights-pick").click();
	await panel.getByTestId("session-insights-selection-compare").click();
	const diff = page.getByTestId("compare-panel");
	await expect(diff).toHaveAttribute("data-a", first.id);
	await expect(diff).toHaveAttribute("data-b", other.id);
	await expect(diff.getByTestId("compare-card-a")).toContainText(first.title);
	await expect(diff.getByTestId("compare-turn-pair")).toHaveCount(2);
	const columns = diff.getByTestId("compare-columns");
	await expect(columns.locator('[data-testid="align-connector"][data-op="same"]')).toHaveCount(4);
	await expect(columns.locator('[data-testid="align-connector"][data-op="similar"]')).toHaveCount(
		1,
	);
	const onlyA = columns.locator('[data-testid="align-row"][data-op="onlyA"]');
	await expect(onlyA).toHaveCount(2);
	await expect(onlyA.first()).toContainText("src/date.test.ts");
	await expect(columns.locator('[data-testid="align-row"][data-op="onlyB"]').first()).toContainText(
		"parseDate",
	);
	await shot(diff, "session-insights/s8", "session-diff");

	await onlyA.first().getByTestId("align-step-a").click();
	const session = page.getByTestId("session-insights-session");
	await expect(session).toHaveAttribute("data-session-id", first.id);
	await expect(session.locator('[data-testid="trace-row"][data-selected="true"]')).toHaveAttribute(
		"data-kind",
		"tool",
	);
});

test("faceted search finds a failing lint call across sessions and opens the session's analysis at it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedStatsSessions(workspace);
	await enterDefaultWorkspace(page);
	await expect(restoredChatTab(page, STATS_SESSIONS.bridge.id)).toBeVisible();
	const panel = await openInsightsPanel(page, { rows: STATS_ROWS });
	await hideAuxiliaryWorkbench(page);

	const search = panel.getByTestId("session-insights-search");
	await panel.getByTestId("session-insights-tab-sessions").focus();
	await page.keyboard.press("/");
	await expect(search).toBeFocused();
	await search.pressSequentially("model:");
	const suggestions = page.getByTestId("session-insights-search-suggestions");
	const model = suggestions.locator(
		'[data-testid="session-insights-search-suggestion"][data-key="model"]',
	);
	await expect(model).toHaveCount(2);
	await expect(model.first()).toHaveAttribute("data-value", "anthropic/claude-sonnet-4-5");
	await expect(model.first()).toHaveAttribute("aria-selected", "true");
	await expect(suggestions).toContainText("claude-bridge/claude-sonnet-4-5");
	const view = panel.getByTestId("insights-search-view");
	await expect(view.getByTestId("insights-search-idle")).toBeVisible();
	await shot(page, "session-insights/s9", "suggestions");

	await search.fill("tool:bash error:yes lint");
	await expect(suggestions).toHaveCount(0);
	const status = view.getByTestId("insights-search-status");
	await expect(status).toHaveAttribute("data-phase", "done");
	await expect(view.getByTestId("insights-search-count")).toHaveText("3 events · 2 sessions");
	await expect(view.getByTestId("insights-search-chip")).toHaveCount(2);
	const groups = view.getByTestId("insights-search-group");
	await expect(groups).toHaveCount(2);
	await expect(groups.first()).toHaveAttribute("data-session-id", STATS_SESSIONS.second.id);
	await expect(groups.first().getByTestId("insights-search-group-matches")).toHaveText("2 matches");
	const hits = view.getByTestId("insights-search-hit");
	await expect(hits).toHaveCount(3);
	const first = hits.first();
	await expect(first).toHaveAttribute("data-kind", "tool");
	await expect(first).toHaveAttribute("data-error", "true");
	await expect(first.getByTestId("insights-search-hit-text")).toHaveText("bun run lint");
	await expect(first.getByTestId("insights-search-mark")).toHaveText("lint");
	await expect(first.getByTestId("insights-search-hit-error")).toContainText("Unexpected any");
	const facet = (key: string, value: string) =>
		view.locator(
			`[data-testid="insights-search-facet"][data-key="${key}"] [data-testid="insights-search-facet-value"][data-value="${value}"]`,
		);
	await expect(facet("tool", "bash").getByTestId("insights-search-facet-count")).toHaveText("3");
	await expect(facet("error", "yes").getByTestId("insights-search-facet-count")).toHaveText("3");
	await expect(facet("error", "yes").locator("input")).toBeChecked();
	await expect(
		facet("model", "anthropic/claude-sonnet-4-5").getByTestId("insights-search-facet-count"),
	).toHaveText("3");
	await shot(panel, "session-insights/s9", "results");

	await panel.getByTestId("session-insights-scope-all").click();
	await expect(view.getByTestId("insights-search-status")).toHaveAttribute("data-phase", "done");
	await expect(
		view.locator('[data-testid="insights-search-facet"][data-key="project"]'),
	).toBeVisible();
	await expect(
		view.locator('[data-testid="insights-search-hint"][data-key="project"]'),
	).toBeVisible();
	await shot(panel, "session-insights/s9", "results-all-projects");
	await panel.getByTestId("session-insights-scope-project").click();
	await expect(
		view.locator('[data-testid="insights-search-facet"][data-key="project"]'),
	).toHaveCount(0);

	await facet("error", "yes").click();
	await expect(search).toHaveValue("tool:bash lint");
	await expect(view.getByTestId("insights-search-count")).toHaveText("6 events · 2 sessions");
	await facet("error", "yes").click();
	await expect(search).toHaveValue("tool:bash lint error:yes");
	await expect(view.getByTestId("insights-search-count")).toHaveText("3 events · 2 sessions");

	await search.focus();
	await page.keyboard.press("End");
	await page.keyboard.press("ArrowDown");
	await expect(first).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(hits.nth(1)).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(first).toBeFocused();
	const eventId = await first.getAttribute("data-event-id");
	await page.keyboard.press("Enter");
	const session = page.getByTestId("session-insights-session");
	await expect(session).toHaveAttribute("data-session-id", STATS_SESSIONS.second.id);
	const selected = session.locator('[data-testid="trace-row"][data-selected="true"]');
	await expect(selected).toHaveAttribute("data-kind", "tool");
	await expect(selected).toHaveAttribute("data-event-id", eventId ?? "");
});

const NETWORK_RESOURCE =
	/\b(?:src|href)\s*=\s*["']?\s*(?:https?:|\/\/)|url\(\s*["']?\s*https?:|@import|<link\b/i;

async function exportAs(
	page: Page,
	session: Locator,
	kind: "html" | "trace" | "fixture",
	screenshot?: string,
	after: "close" | "open" = "close",
): Promise<string> {
	await session.getByTestId("session-insights-export").click();
	await page.locator(`[data-testid="session-insights-export-item"][data-kind="${kind}"]`).click();
	const dialog = page.getByTestId("session-insights-export-dialog");
	await expect(dialog).toHaveAttribute("data-kind", kind);
	await expect(dialog.getByTestId("session-insights-export-masking")).toBeVisible();
	await expect(dialog.getByTestId("session-insights-export-labels")).not.toBeChecked();
	if (screenshot) await shot(dialog, "session-insights/s10", `${screenshot}-options`);
	await dialog.getByTestId("session-insights-export-run").click();
	const path = dialog.getByTestId("session-insights-export-path");
	await expect(path).toBeVisible();
	await expect(dialog.getByTestId("session-insights-export-open")).toBeVisible();
	if (screenshot) await shot(dialog, "session-insights/s10", `${screenshot}-done`);
	const written = (await path.textContent()) ?? "";
	await dialog
		.getByTestId(
			after === "open" ? "session-insights-export-open" : "session-insights-export-close",
		)
		.click();
	await expect(dialog).toHaveCount(0);
	return written;
}

test("labels filter the list and cut the comparison; exports write a masked page, a Chrome trace and a fixture to Artifacts", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedExportSessions(workspace);
	await enterDefaultWorkspace(page);
	const { deploy, docs } = EXPORT_SESSIONS;
	await expect(restoredChatTab(page, deploy.id)).toBeVisible();
	const panel = await openInsightsPanel(page, { rows: [deploy.id, docs.id] });
	await hideAuxiliaryWorkbench(page);

	const row = insightsRow(panel, deploy.id);
	await row.getByTestId("session-insights-labels").click();
	const editor = page.getByTestId("session-insights-labels-editor");
	await expect(editor).toBeVisible();
	await expect(editor.getByTestId("session-insights-label-suggestion").first()).toBeVisible();
	await expect(editor.getByTestId("session-insights-label-input")).toBeFocused();
	await page.keyboard.type("good");
	await page.keyboard.press("Enter");
	await editor.getByTestId("session-insights-note-input").fill("Clean deploy; reuse as a fixture.");
	await shot(editor, "session-insights/s10", "labels-editor");
	await editor.getByTestId("session-insights-labels-save").click();
	await expect(editor).toHaveCount(0);
	await expect(row.getByTestId("session-insights-label")).toHaveText(["good"]);
	await expect(insightsRow(panel, docs.id).getByTestId("session-insights-label")).toHaveCount(0);

	await panel.getByTestId("session-insights-label-filter").click();
	await page
		.locator('[data-testid="session-insights-label-filter-item"][data-label="good"]')
		.click();
	await expect(panel.getByTestId("session-insights-filter")).toContainText(
		"Label: good · 1 session",
	);
	await expect(panel.getByTestId("session-insights-row")).toHaveCount(1);
	await expect(row).toBeVisible();
	await shot(panel, "session-insights/s10", "labels-list");
	await panel.getByTestId("session-insights-filter-clear").click();
	await expect(insightsRow(panel, docs.id)).toBeVisible();

	await panel.getByTestId("session-insights-tab-insights").click();
	const stats = panel.getByTestId("stats-view");
	await stats.getByTestId("stats-section-ab").click();
	const compare = stats.getByTestId("compare-view");
	await compare.getByTestId("compare-by-label").click();
	await expect(compare).toHaveAttribute("data-by", "label");
	await expect(compare.getByTestId("compare-side-a")).toContainText("A · good");
	await expect(compare.getByTestId("compare-side-a")).toContainText("n = 1");
	await expect(compare.getByTestId("compare-side-b")).toContainText("B · the rest");
	await shot(panel, "session-insights/s10", "compare-by-label");

	await panel.getByTestId("session-insights-tab-sessions").click();
	await insightsRow(panel, deploy.id).getByTestId("session-insights-open-analysis").click();
	const session = page.getByTestId("session-insights-session");
	await expect(session).toHaveAttribute("data-session-id", deploy.id);
	await expect(session.getByTestId("session-insights-session-label")).toHaveText(["good"]);
	await session.getByTestId("session-insights-session-note").hover();
	await expect(page.getByRole("tooltip")).toHaveText("Clean deploy; reuse as a fixture.");
	await shot(
		session.getByTestId("session-insights-header"),
		"session-insights/s10",
		"session-header",
	);

	const htmlPath = await exportAs(page, session, "html", "export-html");
	expect(htmlPath).toMatch(/^\.thinkrail\/context\/session-insights\/.+\.html$/);
	const html = readFileSync(join(workspace.worktreePath, htmlPath), "utf8");
	expect(html).toContain("Deploy the staging site");
	expect(html).not.toMatch(NETWORK_RESOURCE);
	expect(html).not.toContain(PLANTED_SECRET);
	expect(html).not.toContain("E2EPLANTEDSECRETVALUE");
	expect(html).not.toContain("ops@example.com");
	expect(html).not.toContain("Clean deploy; reuse as a fixture.");
	const viewer = await page.context().newPage();
	await viewer.setViewportSize({ width: 1100, height: 900 });
	await viewer.goto(pathToFileURL(join(workspace.worktreePath, htmlPath)).href);
	await viewer.getByRole("button", { name: "Expand all" }).click();
	await expect(viewer.locator("details.tool").first()).toHaveAttribute("open", "");
	await shot(viewer, "session-insights/s10", "exported-html-light");
	await viewer.emulateMedia({ colorScheme: "dark" });
	await shot(viewer, "session-insights/s10", "exported-html-dark");
	await viewer.close();

	const tracePath = await exportAs(page, session, "trace", "export-trace");
	expect(tracePath).toMatch(/\.trace\.json$/);
	const trace = JSON.parse(readFileSync(join(workspace.worktreePath, tracePath), "utf8")) as {
		traceEvents: { ph: string; name: string }[];
	};
	expect(trace.traceEvents.length).toBeGreaterThan(5);
	expect(trace.traceEvents.map((event) => event.ph)).toEqual(
		expect.arrayContaining(["M", "X", "C"]),
	);
	expect(JSON.stringify(trace)).not.toContain("E2EPLANTEDSECRETVALUE");

	const fixturePath = await exportAs(page, session, "fixture", "export-fixture", "open");
	expect(fixturePath).toMatch(/\/fixtures\/[a-z0-9-]+\/$/);
	const sessionFile = join(workspace.worktreePath, fixturePath, "session.jsonl");
	expect(existsSync(sessionFile)).toBe(true);
	expect(readFileSync(sessionFile, "utf8")).not.toContain("E2EPLANTEDSECRETVALUE");
	expect(existsSync(join(workspace.worktreePath, fixturePath, "workspace"))).toBe(false);

	const artifacts = page.getByTestId("artifacts-panel");
	await expect(artifacts.getByTestId("artifacts-view")).toHaveAttribute("data-view", "list");
	await expect(
		artifacts.locator(`[data-testid="artifact-row"][data-path="${fixturePath}session.jsonl"]`),
	).toBeVisible();
});

test("the list's tabs read Sessions, Days and Insights; Insights counts its findings and keeps its section", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedStatsSessions(workspace);
	await enterDefaultWorkspace(page);
	await expect(restoredChatTab(page, STATS_SESSIONS.bridge.id)).toBeVisible();
	const panel = await openInsightsPanel(page, { rows: STATS_ROWS });
	await expect(panel.getByTestId("session-insights-tab-sessions")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const badge = panel.getByTestId("session-insights-insights-badge");
	await expect(badge).toBeVisible();
	await badge.hover();
	await expect(page.getByRole("tooltip")).toContainText(/\d+ findings · /);

	await panel.getByTestId("session-insights-tab-insights").click();
	const stats = panel.getByTestId("stats-view");
	const findings = stats.getByTestId("findings-view");
	await expect(findings).toBeVisible();
	await expect(stats.getByTestId("stats-progress")).toHaveCount(0);
	const cards = findings.locator('[data-testid="finding-card"][data-hidden="false"]');
	const before = await cards.count();
	await expect(badge.locator('[aria-hidden="true"]')).toHaveText(String(before));
	await findings
		.locator('[data-testid="finding-card"][data-rule="rework"]')
		.getByTestId("finding-hide")
		.click();
	await expect(badge.locator('[aria-hidden="true"]')).toHaveText(String(before - 1));
	await expect(stats.getByTestId("stats-section-findings")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await stats.getByTestId("stats-section-findings").focus();
	await page.keyboard.press("ArrowRight");
	await expect(stats.getByTestId("stats-section-usage")).toHaveAttribute("aria-selected", "true");
	await expect(stats.getByTestId("usage-view")).toBeVisible();
	await shot(panel, "session-insights/list", "insights-tabs");

	await panel.getByTestId("session-insights-tab-sessions").click();
	await expect(panel.getByTestId("session-insights-table")).toBeVisible();
	await panel.getByTestId("session-insights-tab-insights").click();
	await expect(stats.getByTestId("stats-section-usage")).toHaveAttribute("aria-selected", "true");

	await panel.getByTestId("session-insights-tab-sessions").click();
	await insightsRow(panel, STATS_SESSIONS.first.id)
		.getByTestId("session-insights-open-analysis")
		.click();
	await expect(page.getByTestId("session-insights-session")).toBeVisible();
	await listTab(page).click();
	await expect(panel.getByTestId("session-insights-tab-sessions")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await panel.getByTestId("session-insights-tab-insights").click();
	await expect(stats.getByTestId("stats-section-usage")).toHaveAttribute("aria-selected", "true");
});

test("ticked sessions compare as A and B, survive a scope switch, and figure tooltips let clicks through", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	seedSequenceSessions(workspace);
	await enterDefaultWorkspace(page);
	const [first, second] = SEQUENCE_SESSIONS.sonnet;
	const [other] = SEQUENCE_SESSIONS.gpt;
	await expect(restoredChatTab(page, SEQUENCE_SESSIONS.sonnet[3].id)).toBeVisible();
	const panel = await openInsightsPanel(page, {
		rows: [...SEQUENCE_SESSIONS.sonnet, ...SEQUENCE_SESSIONS.gpt].map((session) => session.id),
	});

	await panel.getByTestId("session-insights-tab-insights").click();
	const stats = panel.getByTestId("stats-view");
	await stats.getByTestId("stats-section-ab").click();
	const compare = stats.getByTestId("compare-view");
	await expect(compare.getByTestId("compare-side-a")).toContainText(SEQUENCE_MODELS.sonnet);
	await compare.getByTestId("compare-swap").click();
	await expect(compare.getByTestId("compare-side-a")).toContainText(SEQUENCE_MODELS.gpt);
	await expect(compare.getByTestId("compare-side-b")).toContainText(SEQUENCE_MODELS.sonnet);
	await compare.getByTestId("compare-pick-a").click();
	await expect(
		page.locator(`[data-testid="compare-option"][data-key="${SEQUENCE_MODELS.sonnet}"]`),
	).toHaveAttribute("data-disabled", "");
	await page.keyboard.press("Escape");

	await panel.getByTestId("session-insights-tab-sessions").click();
	const firstRow = insightsRow(panel, first.id);
	const otherRow = insightsRow(panel, other.id);
	const secondRow = insightsRow(panel, second.id);
	await expect(firstRow.getByTestId("session-insights-pick")).toHaveCSS("opacity", "0");
	await firstRow.hover();
	await expect(firstRow.getByTestId("session-insights-pick")).toHaveCSS("opacity", "1");
	await firstRow.getByTestId("session-insights-pick").click();
	const bar = panel.getByTestId("session-insights-selection-bar");
	await expect(bar).toContainText("1 session selected");
	await expect(bar.getByTestId("session-insights-selection-compare")).toBeDisabled();
	await otherRow.getByTestId("session-insights-calls").locator("button").focus();
	await page.keyboard.press(" ");
	await expect(bar).toContainText("2 sessions selected");
	const chips = bar.getByTestId("session-insights-selection-chip");
	await expect(chips.nth(0)).toHaveAttribute("data-session-id", first.id);
	await expect(chips.nth(1)).toHaveAttribute("data-session-id", other.id);
	await bar.getByTestId("session-insights-selection-swap").click();
	await expect(chips.nth(0)).toHaveAttribute("data-session-id", other.id);
	await bar.getByTestId("session-insights-selection-swap").click();
	await expect(chips.nth(0)).toHaveAttribute("data-session-id", first.id);

	await secondRow.getByTestId("session-insights-pick").click();
	await expect(bar).toContainText("3 sessions selected");
	await expect(bar).toContainText("Pick exactly two");
	await expect(bar.getByTestId("session-insights-selection-compare")).toBeDisabled();
	await secondRow.getByTestId("session-insights-pick").click();

	await panel.getByTestId("session-insights-scope-all").click();
	await expect(bar).toContainText("2 sessions selected");
	await panel.getByTestId("session-insights-scope-project").click();
	await expect(bar).toContainText("2 sessions selected");
	await shot(panel, "session-insights/list", "selection-bar");

	const rowsInOrder = panel.getByTestId("session-insights-row");
	await rowsInOrder.nth(2).getByTestId("session-insights-cost").hover();
	await expect(page.getByRole("tooltip")).toBeVisible();
	const below = rowsInOrder.nth(3);
	await below.getByTestId("session-insights-pick").click({ force: true });
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await expect(below.getByTestId("session-insights-pick")).toBeChecked();
	await below.getByTestId("session-insights-pick").click();

	await rowsInOrder.nth(2).getByTestId("session-insights-pick").focus();
	await page.keyboard.press("End");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await expect(
		rowsInOrder.nth(2).getByTestId("session-insights-cost").locator("button"),
	).toBeFocused();
	await expect(page.getByRole("tooltip")).toBeVisible();
	const covered = rowsInOrder.nth(1).getByTestId("session-insights-tokens").locator("button");
	await covered.click();
	await expect(covered).toBeFocused();

	await firstRow.getByTestId("session-insights-pick").focus();
	await page.keyboard.press("Escape");
	await expect(bar).toHaveCount(0);
	await firstRow.getByTestId("session-insights-pick").click();
	await otherRow.getByTestId("session-insights-pick").click();
	await otherRow.getByTestId("session-insights-pick").focus();
	await page.keyboard.press("Enter");
	const diff = page.getByTestId("compare-panel");
	await expect(diff).toHaveAttribute("data-a", first.id);
	await expect(diff).toHaveAttribute("data-b", other.id);
	await expect(diff.getByTestId("compare-card-a")).toContainText(first.title);
});

test("a session opens on an Overview whose cards lead into its sections; a tab brought back keeps its place and Compare with… picks B", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	const { delegationDir } = seedInsightsSessions(workspace);
	const { priced, unpriced } = INSIGHTS_SESSIONS;
	try {
		await enterDefaultWorkspace(page);
		await expect(restoredChatTab(page, priced.id)).toBeVisible();
		const panel = await openInsightsPanel(page, { rows: INSIGHTS_ROWS });
		await insightsRow(panel, priced.id).getByTestId("session-insights-open-analysis").click();
		const session = page.getByTestId("session-insights-session");
		await expect(session).toHaveAttribute("data-session-id", priced.id);

		const header = session.getByTestId("session-insights-header");
		const headerBox = await header.boundingBox();
		expect(headerBox && headerBox.height <= 41).toBe(true);
		await session.getByTestId("session-insights-session-cost").hover();
		await expect(
			page.locator('[data-testid="session-insights-figure"][data-metric="cost"]').first(),
		).toContainText("Recorded by pi");

		const overview = session.getByTestId("session-insights-overview");
		await expect(overview.getByTestId("overview-happened")).toBeVisible();
		await expect(overview.getByTestId("overview-cost")).toContainText("$0.42");
		await expect(overview.getByTestId("overview-errors-summary")).toContainText("1 failure");
		await expect(overview.getByTestId("overview-context")).toBeVisible();
		await expect(overview.getByTestId("overview-files")).toBeVisible();
		await expect(overview.getByTestId("overview-subagents")).toBeVisible();
		await shot(page, "session-insights/overview", "overview");

		await overview.getByTestId("overview-link-errors").click();
		await expect(session.getByTestId("session-insights-section-errors")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(session.getByTestId("errors-chain").first()).toBeVisible();
		await session.getByTestId("session-insights-section-overview").click();
		await overview.getByTestId("overview-link-cost").click();
		await expect(session.getByTestId("session-insights-section-cost")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(session.getByTestId("cost-view")).toBeVisible();

		await session.getByTestId("session-insights-section-trace").click();
		const failing = session.locator(
			'[data-testid="trace-row"][data-kind="tool"][data-error="true"]',
		);
		await failing.click();
		await expect(failing).toHaveAttribute("data-selected", "true");
		await listTab(page).click();
		await expect(panel).toBeVisible();
		await analysisTab(page, priced.title).click();
		await expect(session.getByTestId("session-insights-section-trace")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(failing).toHaveAttribute("data-selected", "true");

		await session.getByTestId("session-insights-section-overview").click();
		await overview.getByTestId("overview-link-findings").click();
		await expect(listTab(page)).toHaveAttribute("data-active", "true");
		await expect(panel.getByTestId("session-insights-tab-insights")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(
			panel.getByTestId("stats-view").getByTestId("stats-section-findings"),
		).toHaveAttribute("aria-selected", "true");

		await analysisTab(page, priced.title).click();
		await session.getByTestId("session-insights-compare-with").click();
		const picker = page.getByTestId("compare-picker");
		await expect(picker).toBeVisible();
		await expect(picker.getByTestId("compare-picker-option")).toHaveCount(2);
		await picker.getByTestId("compare-picker-search").fill("changelog");
		await expect(picker.getByTestId("compare-picker-option")).toHaveCount(1);
		await page.keyboard.press("Enter");
		const diff = page.getByTestId("compare-panel");
		await expect(diff).toHaveAttribute("data-a", priced.id);
		await expect(diff).toHaveAttribute("data-b", unpriced.id);
	} finally {
		rmSync(delegationDir, { recursive: true, force: true });
	}
});

test("beside its chat the analysis shows a picked call in the chat in place, and its own controls move or close it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await openFixtureProject(page);
	const workspace = await defaultWorkspace();
	const { delegationDir } = seedInsightsSessions(workspace);
	const { priced } = INSIGHTS_SESSIONS;
	try {
		await enterDefaultWorkspace(page);
		const chatTab = restoredChatTab(page, priced.id);
		await chatTab.click();
		await expect(page.getByTestId("left-stack")).toBeVisible();
		const toggle = page.getByTestId("chat-toolbar").getByTestId("chat-header-toggle");
		await toggle.click();
		const pane = page.getByTestId("chat-pane");
		await expect(pane).toBeVisible();
		await expect(page.getByTestId("left-stack")).toHaveCount(0);
		await expect(page.getByTestId("right-stack")).toHaveCount(0);
		await expect(page.getByTestId("bottom-panel")).toHaveCount(0);

		const session = pane.getByTestId("session-insights-session");
		await expect(session.getByTestId("session-insights-session-open-chat")).toHaveCount(0);
		await expect(session.getByTestId("session-insights-open-as-tab")).toBeVisible();
		await session.getByTestId("session-insights-section-trace").click();
		const failing = session.locator(
			'[data-testid="trace-row"][data-kind="tool"][data-error="true"]',
		);
		await failing.click();
		const flashed = page.locator('[data-chat-row-id="activity:bash-1"] [data-flash]');
		await expect(flashed).toBeVisible();
		await expect(flashed).toContainText("bun test retry");
		await expect(chatTab).toHaveAttribute("data-active", "true");
		const show = session.getByTestId("trace-details").getByTestId("details-open-chat");
		await expect(show).toContainText("Show in chat");
		await expect(show).toContainText("shown at left");
		await shot(page, "session-insights/pane", "show-in-chat");

		await page.keyboard.press("Control+Shift+F12");
		await expect(page.getByTestId("left-stack")).toBeVisible();
		await session.getByTestId("session-insights-close-pane").click();
		await expect(pane).toHaveCount(0);
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await toggle.click();
		await expect(pane.getByTestId("session-insights-section-trace")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await pane.getByTestId("session-insights-open-as-tab").click();
		await expect(pane).toHaveCount(0);
		await expectAnalysisOf(page, priced.id, priced.title);
		await expect(
			page.getByTestId("session-insights-session").getByTestId("session-insights-section-trace"),
		).toHaveAttribute("aria-selected", "true");
	} finally {
		rmSync(delegationDir, { recursive: true, force: true });
	}
});
