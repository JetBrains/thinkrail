import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
} from "../fixtures/app";
import { commitFile } from "../fixtures/git";
import { E2E_FIXTURE_REPO } from "../fixtures/paths";
import { seedWorkspaceSession } from "../fixtures/sessions";
import { buildChatReplay, chatHistory } from "./chatReplay";
import {
	assertPreciseTimers,
	attachRenderProfiler,
	detachRenderProfiler,
	type RenderProfile,
	readRenderProfile,
	resetRenderProfile,
} from "./renderProfiler";

const RUNS = Number(process.env.THINKRAIL_PERF_RUNS ?? 5);
const OUT_DIR = process.env.THINKRAIL_PERF_OUT ?? join(process.cwd(), "test-results", "perf-runs");
const STEP_GAP_MS = 40;
const LIVE_EDITS = 20;
const DIFF_LINES = 3_000;
const SCROLL_STEPS = 40;

function pause(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ScenarioRun {
	scenario: string;
	run: number;
	wallMs: number;
	profile: RenderProfile;
}

function record(scenario: string, run: number, wallMs: number, profile: RenderProfile): void {
	mkdirSync(OUT_DIR, { recursive: true });
	const result: ScenarioRun = { scenario, run, wallMs, profile };
	writeFileSync(join(OUT_DIR, `${scenario}-${run}.json`), JSON.stringify(result));
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
	action: () => Promise<void>,
): Promise<void> {
	await nextFrames(page);
	await resetRenderProfile(page);
	const startedAt = performance.now();
	await action();
	await nextFrames(page);
	const wallMs = performance.now() - startedAt;
	record(scenario, run, wallMs, await readRenderProfile(page));
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
	await assertPreciseTimers(page);
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
	});
}

async function liveFileEdits(page: Page, run: number): Promise<void> {
	await openFixtureProject(page);
	await assertPreciseTimers(page);
	const workspace = await createWorkspaceViaDialog(page);
	const path = join(workspace.worktreePath, "live-edit.ts");
	writeFileSync(
		path,
		numberedSource(400, (line) => (line === 0 ? "// revision 0" : null)),
	);
	await page.getByTestId("tab-files").click();
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
	});
}

async function largeDiff(page: Page, run: number): Promise<void> {
	await openFixtureProject(page);
	await assertPreciseTimers(page);
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
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	const change = page.getByTestId("change-item").filter({ hasText: "large-diff.ts" });
	await expect(change).toBeVisible();

	await measure(page, "large-diff", run, async () => {
		await change.click();
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
	});
}

const SCENARIOS = [
	["chat-streaming", chatStreaming],
	["live-file-edits", liveFileEdits],
	["large-diff", largeDiff],
] as const;

test.beforeEach(async ({ page, baseURL }) => {
	if (!baseURL) throw new Error("perf runs need a baseURL");
	await attachRenderProfiler(page, baseURL);
});

test.afterEach(async ({ page }) => {
	await detachRenderProfiler(page);
});

for (let run = 1; run <= RUNS; run += 1) {
	for (const [name, scenario] of SCENARIOS) {
		test(`${name} run ${run}`, async ({ page }) => {
			await scenario(page, run);
		});
	}
}
