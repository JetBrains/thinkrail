import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	pressPlatformShortcut,
	revealWorkbenchTool,
	waitTerminalReady,
} from "../fixtures/app";
import { commitFile } from "../fixtures/git";
import { E2E_FIXTURE_REPO } from "../fixtures/paths";
import { seedWorkspaceSession } from "../fixtures/sessions";
import { buildChatReplay, buildTextReplay, type ChatReplay, chatHistory } from "./chatReplay";
import { longMarkdown } from "./longMarkdown";
import {
	assertProfilingReady,
	attachRenderProfiler,
	detachRenderProfiler,
	MARKDOWN_SUBTREE,
	type MainThreadCost,
	type RenderProfile,
	readRenderProfile,
	resetRenderProfile,
	startMainThreadProbe,
} from "./renderProfiler";
import { DEFAULT_SCENARIOS, SCENARIO_NAMES, type ScenarioName } from "./scenarios";

const RUNS = Number(process.env.THINKRAIL_PERF_RUNS ?? 5);
const OUT_DIR = process.env.THINKRAIL_PERF_OUT ?? join(process.cwd(), "test-results", "perf-runs");
const STEP_GAP_MS = 40;
const LIVE_EDITS = 20;
const DIFF_LINES = 3_000;
const SCROLL_STEPS = 40;
const LONG_STREAM_GAP_MS = 15;
const PARALLEL_AGENTS = 20;
const HEAVY_TIMEOUT_MS = 600_000;
const SELECTED = new Set(process.env.THINKRAIL_PERF_SCENARIOS?.split(",") ?? DEFAULT_SCENARIOS);
const CPU_RATE = Number(process.env.THINKRAIL_PERF_CPU ?? 1);
const LONG_STREAM_CHARS = 25_000;
const LONG_STREAM_XL_CHARS = 100_000;
const SUBTREE_ROOTS = {
	[MARKDOWN_SUBTREE]: (
		process.env.THINKRAIL_PERF_MARKDOWN_ROOTS ?? "AssistantMarkdown,Markdown"
	).split(","),
};

function pause(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Counters {
	[name: string]: number;
}

export interface ScenarioRun {
	scenario: string;
	run: number;
	cpuRate: number;
	wallMs: number;
	counters: Counters;
	mainThread: MainThreadCost;
	profile: RenderProfile;
}

function record(result: ScenarioRun): void {
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(join(OUT_DIR, `${result.scenario}-${result.run}.json`), JSON.stringify(result));
}

async function nextFrames(page: Page, count = 2): Promise<void> {
	await page.evaluate(async (frames) => {
		for (let frame = 0; frame < frames; frame += 1) await new Promise(requestAnimationFrame);
	}, count);
}

async function measure(
	page: Page,
	scenario: string,
	run: number,
	action: () => Promise<Counters>,
): Promise<void> {
	await nextFrames(page);
	const stopProbe = await startMainThreadProbe(page, CPU_RATE);
	await resetRenderProfile(page);
	const startedAt = performance.now();
	const counters = await action();
	await nextFrames(page);
	const wallMs = performance.now() - startedAt;
	const profile = await readRenderProfile(page);
	const mainThread = await stopProbe();
	record({ scenario, run, cpuRate: CPU_RATE, wallMs, counters, mainThread, profile });
}

async function interceptWire(page: Page): Promise<() => WebSocketRoute> {
	let current: WebSocketRoute | null = null;
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => server.send(message));
		server.onMessage((message) => browser.send(message));
		current = browser;
	});
	return () => {
		if (!current) throw new Error("app wire is not connected");
		return current;
	};
}

function maxScrollTop(root: Locator): Promise<number> {
	return root.evaluate((element) => {
		const nodes: Element[] = [element];
		let top = 0;
		while (nodes.length > 0) {
			const node = nodes.pop();
			if (!node) break;
			top = Math.max(top, node.scrollTop);
			if (node.shadowRoot) nodes.push(...node.shadowRoot.children);
			nodes.push(...node.children);
		}
		return top;
	});
}

function numberedSource(lines: number, edit: (line: number) => string | null): string {
	return `${Array.from(
		{ length: lines },
		(_, line) => edit(line) ?? `export const value${line} = ${line} * 2; // stable line ${line}`,
	).join("\n")}\n`;
}

async function chatStreaming(page: Page, run: number): Promise<void> {
	const wire = await interceptWire(page);
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const title = `Streaming replay ${run}`;
	const seeded = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: title,
		messages: chatHistory(1_700_900_000_000, 24),
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
	const chat = page.getByTestId("chat-scroll");
	await expect(chat).toBeVisible();
	await expect(
		page.locator('[data-testid="chat-message"][data-role="assistant"]').first(),
	).toBeVisible();

	const replay = buildChatReplay(seeded.id);
	await measure(page, "chat-streaming", run, async () => {
		const socket = wire();
		for (const step of replay.steps) {
			for (const frame of step.frames) socket.send(frame);
			await pause(STEP_GAP_MS);
		}
		await expect(chat).toContainText(replay.finalText);
		await expect(chat).toHaveAttribute("data-streaming", "false");
		return { deltas: replay.deltaCount };
	});
}

function longStream(scenario: string, targetChars: number) {
	return async (page: Page, run: number): Promise<void> => {
		const wire = await interceptWire(page);
		await openFixtureProject(page);
		await assertProfilingReady(page);
		const title = `Long stream replay ${run}`;
		const seeded = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
			name: title,
			messages: chatHistory(1_700_900_000_000, 4),
		});
		await enterDefaultWorkspace(page);
		await openPersistedChat(page, title);
		const chat = page.getByTestId("chat-scroll");
		await expect(chat).toBeVisible();

		const replay = buildTextReplay(seeded.id, longMarkdown(targetChars));
		await measure(page, scenario, run, async () => {
			const socket = wire();
			for (const step of replay.steps) {
				for (const frame of step.frames) socket.send(frame);
				await pause(LONG_STREAM_GAP_MS);
			}
			await expect(chat).toContainText(replay.finalText, { timeout: 120_000 });
			await expect(chat).toHaveAttribute("data-streaming", "false");
			return { deltas: replay.deltaCount };
		});
	};
}

interface AgentChat {
	title: string;
	replay: ChatReplay;
}

async function openAgentChats(page: Page, run: number): Promise<AgentChat[]> {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	const agents = Array.from({ length: PARALLEL_AGENTS }, (_, index) => {
		const title = `Agent ${run}-${String(index + 1).padStart(2, "0")}`;
		const seeded = seedWorkspaceSession(repo, {
			name: title,
			messages: chatHistory(1_700_900_000_000 + index * 1_000_000, 3, 100 + index),
		});
		return { title, replay: buildChatReplay(seeded.id, 200 + index) };
	});
	await enterDefaultWorkspace(page);
	for (const agent of agents) await openPersistedChat(page, agent.title);
	return agents;
}

async function streamInterleaved(socket: WebSocketRoute, replays: ChatReplay[]): Promise<void> {
	const longest = Math.max(...replays.map((replay) => replay.steps.length));
	for (let step = 0; step < longest; step += 1) {
		for (const replay of replays)
			for (const frame of replay.steps[step]?.frames ?? []) socket.send(frame);
		await pause(STEP_GAP_MS);
	}
}

function parallelAgents(includeVisible: boolean) {
	return async (page: Page, run: number): Promise<void> => {
		const scenario = includeVisible ? "parallel-agents" : "background-agents";
		const wire = await interceptWire(page);
		await openFixtureProject(page);
		await assertProfilingReady(page);
		const agents = await openAgentChats(page, run);
		const visible = agents.at(-1);
		const background = agents[0];
		if (!visible || !background) throw new Error("no agent chats");
		const tab = (agent: AgentChat) =>
			page.locator('[data-testid="editor-tab"][data-kind="chat"]').filter({ hasText: agent.title });
		await tab(visible).click();
		await expect(tab(visible)).toHaveAttribute("data-active", "true");
		const chat = page.getByTestId("chat-scroll").filter({ visible: true });
		await expect(chat).toHaveCount(1);
		await expect(
			chat.locator('[data-testid="chat-message"][data-role="assistant"]').first(),
		).toBeVisible();
		const streaming = includeVisible ? agents : agents.slice(0, -1);

		await measure(page, scenario, run, async () => {
			await streamInterleaved(
				wire(),
				streaming.map((agent) => agent.replay),
			);
			if (includeVisible) {
				await expect(chat).toContainText(visible.replay.finalText, { timeout: 120_000 });
				await expect(chat).toHaveAttribute("data-streaming", "false");
			} else {
				await pause(250);
			}
			return {
				deltas: streaming.reduce((sum, agent) => sum + agent.replay.deltaCount, 0),
				streamingSessions: streaming.length,
				mountedChats: await page.getByTestId("chat-scroll").count(),
			};
		});

		await tab(background).click();
		await expect(chat).toContainText(background.replay.finalText);
	};
}

async function regionToggles(page: Page, run: number): Promise<void> {
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const title = `Region toggle fixture ${run}`;
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: title,
		messages: chatHistory(1_700_900_000_000, 12),
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, title);
	await expect(page.getByTestId("chat-scroll")).toBeVisible();
	await waitTerminalReady(page);
	const specs = page.getByTestId("tool-rail-specs");
	await expect(specs).toHaveAttribute("aria-pressed", "true");

	await measure(page, "region-toggles", run, async () => {
		await specs.click();
		await expect(specs).toHaveAttribute("aria-pressed", "false");
		await specs.click();
		await expect(specs).toHaveAttribute("aria-pressed", "true");
		await pressPlatformShortcut(page, "j");
		await expect(page.getByTestId("right-stack")).toHaveCount(0);
		await pressPlatformShortcut(page, "j");
		await expect(page.getByTestId("right-stack")).toBeVisible();
		await pressPlatformShortcut(page, "Shift+j");
		await expect(page.getByTestId("bottom-panel")).toHaveCount(0);
		await pressPlatformShortcut(page, "Shift+j");
		await waitTerminalReady(page);
		return {};
	});
}

async function liveFileEdits(page: Page, run: number): Promise<void> {
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const workspace = await createWorkspaceViaDialog(page);
	const path = join(workspace.worktreePath, "live-edit.ts");
	writeFileSync(
		path,
		numberedSource(400, (line) => (line === 0 ? "// revision 0" : null)),
	);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "live-edit.ts" }).dblclick();
	const editor = page.getByTestId("editor-pane");
	await expect(editor).toContainText("revision 0");

	await measure(page, "live-file-edits", run, async () => {
		for (let revision = 1; revision <= LIVE_EDITS; revision += 1) {
			writeFileSync(
				path,
				numberedSource(400 + revision * 5, (line) =>
					line === 0
						? `// revision ${revision}`
						: line % 25 === revision % 25
							? `export const edited${line} = ${revision};`
							: null,
				),
			);
			await expect(editor).toContainText(`revision ${revision}`, { timeout: 10_000 });
		}
		return {};
	});
}

async function largeDiff(page: Page, run: number): Promise<void> {
	await openFixtureProject(page);
	await assertProfilingReady(page);
	const workspace = await createWorkspaceViaDialog(page);
	commitFile(
		workspace.worktreePath,
		"large-diff.ts",
		numberedSource(DIFF_LINES, () => null),
		"add large diff base",
	);
	writeFileSync(
		join(workspace.worktreePath, "large-diff.ts"),
		numberedSource(DIFF_LINES, (line) =>
			line % 7 === 0 ? `export const changed${line} = "${line}"; // changed line ${line}` : null,
		),
	);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	const change = page.getByTestId("change-item").filter({ hasText: "large-diff.ts" });
	await expect(change).toBeVisible();

	await measure(page, "large-diff", run, async () => {
		await change.dblclick();
		const diff = page.getByTestId("diff-view");
		await expect(diff.getByText("changed line 0", { exact: false }).first()).toBeVisible({
			timeout: 20_000,
		});
		const box = await diff.boundingBox();
		if (!box) throw new Error("diff view has no layout box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		for (let step = 0; step < SCROLL_STEPS; step += 1) {
			await page.mouse.wheel(0, 600);
			await nextFrames(page);
		}
		expect(await maxScrollTop(diff)).toBeGreaterThan(SCROLL_STEPS * 300);
		return {};
	});
}

const SCENARIOS: Record<ScenarioName, (page: Page, run: number) => Promise<void>> = {
	"chat-streaming": chatStreaming,
	"region-toggles": regionToggles,
	"live-file-edits": liveFileEdits,
	"large-diff": largeDiff,
	"long-stream": longStream("long-stream", LONG_STREAM_CHARS),
	"long-stream-xl": longStream("long-stream-xl", LONG_STREAM_XL_CHARS),
	"parallel-agents": parallelAgents(true),
	"background-agents": parallelAgents(false),
};
const HEAVY = new Set<ScenarioName>([
	"long-stream",
	"long-stream-xl",
	"parallel-agents",
	"background-agents",
]);

test.beforeEach(async ({ page, baseURL }) => {
	if (!baseURL) throw new Error("perf runs need a baseURL");
	await attachRenderProfiler(page, baseURL, SUBTREE_ROOTS);
});

test.afterEach(async ({ page }) => {
	await detachRenderProfiler(page);
});

for (let run = 1; run <= RUNS; run += 1) {
	for (const name of SCENARIO_NAMES) {
		if (!SELECTED.has(name)) continue;
		const scenario = SCENARIOS[name];
		test(`${name} run ${run}`, async ({ page }) => {
			if (HEAVY.has(name)) test.setTimeout(HEAVY_TIMEOUT_MS);
			await scenario(page, run);
		});
	}
}
