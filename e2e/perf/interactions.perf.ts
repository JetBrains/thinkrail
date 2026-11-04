import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
} from "../fixtures/app";
import { commitFile } from "../fixtures/git";
import { E2E_FIXTURE_REPO } from "../fixtures/paths";
import { pagedPdf } from "../fixtures/repo";
import { seedWorkspaceSession } from "../fixtures/sessions";
import {
	driveInteraction,
	type InteractionSpec,
	type InteractionStep,
	stubResourceWire,
} from "./interactionDriver";
import type { ScenarioRun } from "./render.perf";
import {
	attachRenderProfiler,
	detachRenderProfiler,
	installRenderProfiler,
	startMainThreadProbe,
} from "./renderProfiler";

const OUT_DIR = process.env.THINKRAIL_PERF_OUT ?? join(tmpdir(), "thinkrail-perf-runs");
const RUNS = Number(process.env.THINKRAIL_PERF_RUNS ?? 5);
const ENGINES = (process.env.THINKRAIL_PERF_ENGINES ?? "chromium,wkwebview").split(",");
const SELECTED = process.env.THINKRAIL_PERF_INTERACTIONS?.split(",");
const WK_TIMEOUT_MS = 170_000;
const RESOURCE_STUB = { subagents: 60, createdAt: "2026-01-01T00:00:00.000Z" };

const testid = (id: string) => `[data-testid="${id}"]`;
const openUncommittedChange = (path: string): InteractionStep[] => [
	{ op: "click", selector: testid("tool-rail-files") },
	{ op: "click", selector: testid("files-mode-changed") },
	{ op: "click", selector: testid("changes-scope-trigger") },
	{ op: "click", selector: testid("changes-scope-uncommitted") },
	{ op: "click", selector: testid("change-item"), hasText: path, double: true },
];

function csvText(edit: boolean): string {
	const rows = Array.from({ length: 1_000 }, (_, row) =>
		Array.from({ length: 6 }, (_, col) =>
			edit && row % 10 === 0 && col === 2 ? `edited-${row}` : `r${row}c${col}`,
		).join(","),
	);
	return `a,b,c,d,e,f\n${rows.join("\n")}\n`;
}

function jsonText(edit: boolean): string {
	const entries = Array.from({ length: 800 }, (_, index) => [
		`key${index}`,
		{ id: index, value: edit && index % 10 === 0 ? `edited-${index}` : `value-${index}` },
	]);
	return `${JSON.stringify(Object.fromEntries(entries), null, 1)}\n`;
}

function notebookText(edit: boolean): string {
	const cells = Array.from({ length: 150 }, (_, index) => ({
		cell_type: "code",
		execution_count: null,
		metadata: {},
		outputs: [],
		source: [
			`value_${index} = ${edit && index % 10 === 0 ? index * 2 : index}\n`,
			`print(value_${index})\n`,
		],
	}));
	return JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 });
}

interface Interaction extends InteractionSpec {
	seed: (page: Page) => Promise<void>;
	resources?: boolean;
}

const textDiff = (
	path: string,
	text: (edit: boolean) => string,
	surface: string,
	measured: InteractionStep[],
): Interaction => ({
	seed: async (page) => {
		const { worktreePath } = await createWorkspaceViaDialog(page);
		commitFile(worktreePath, path, text(false), `add ${path}`);
		writeFileSync(join(worktreePath, path), text(true));
	},
	setup: [...openUncommittedChange(path), { op: "wait", selector: testid(surface) }],
	measured,
});

const INTERACTIONS = {
	"csv-diff-select": textDiff("perf.csv", csvText, "csv-diff", [
		{ op: "clickEach", selector: `${testid("csv-diff")} tbody button`, count: 20, stride: 7 },
	]),
	"json-diff-select": textDiff("perf.json", jsonText, "json-diff", [
		{
			op: "clickEach",
			selector: `${testid("json-diff")} button:not([aria-label]):not(:disabled)`,
			count: 20,
			stride: 3,
		},
	]),
	"notebook-diff-select": textDiff("perf.ipynb", notebookText, "notebook-diff", [
		{ op: "clickEach", selector: testid("notebook-comment-cell-worktree"), count: 12, stride: 2 },
	]),
	"pdf-diff-pages": {
		seed: async (page) => {
			const { worktreePath } = await createWorkspaceViaDialog(page);
			commitFile(worktreePath, "perf.pdf", pagedPdf(30, "BASE"), "add perf.pdf");
			writeFileSync(join(worktreePath, "perf.pdf"), pagedPdf(30, "EDIT"));
		},
		setup: [...openUncommittedChange("perf.pdf"), { op: "wait", selector: testid("pdf-diff") }],
		measured: [
			{
				op: "clickRepeat",
				selector: `${testid("pdf-diff")} button[aria-label="Next PDF page"]`,
				count: 15,
			},
		],
	},
	"image-view-zoom": {
		seed: async (page) => {
			await createWorkspaceViaDialog(page);
		},
		setup: [
			{ op: "click", selector: testid("tool-rail-files") },
			{ op: "click", selector: testid("files-mode-all") },
			{ op: "click", selector: testid("file-node"), hasText: "RENDERERS.png", double: true },
			{ op: "wait", selector: testid("image-resource") },
		],
		measured: [
			{
				op: "clickRepeat",
				selector: `${testid("image-view")} button[aria-label="Zoom in"]`,
				count: 30,
			},
		],
	},
	"image-diff-modes": {
		seed: async (page) => {
			const { worktreePath } = await createWorkspaceViaDialog(page);
			const path = join(worktreePath, "RENDERERS.png");
			writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("changed")]));
		},
		setup: [
			...openUncommittedChange("RENDERERS.png"),
			{ op: "wait", selector: testid("image-diff-mode") },
		],
		measured: [{ op: "clickEach", selector: `${testid("image-diff-mode")} button`, count: 18 }],
	},
	"resources-inspector-keys": {
		resources: true,
		seed: async (page) => {
			seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
				name: "Resource perf",
				messages: [{ role: "user", text: "Inspect resources.", timestamp: Date.now() }],
			});
			await enterDefaultWorkspace(page);
		},
		setup: [
			{ op: "openChat", title: "Resource perf" },
			{ op: "click", selector: testid("resources-trigger") },
			{
				op: "click",
				selector: `${testid("resources-inspector")} [data-resource-id] [role="option"]`,
			},
		],
		measured: [{ op: "key", key: "ArrowDown", count: 40 }],
	},
	"history-search": {
		seed: async (page) => {
			const repo = realpathSync(E2E_FIXTURE_REPO);
			for (let index = 0; index < 40; index += 1) {
				seedWorkspaceSession(repo, {
					name: `History ${index}`,
					messages: [
						{
							role: "user",
							text: `needle prompt about module ${index}`,
							timestamp: 1_700_000_000_000 + index,
						},
					],
				});
			}
			await enterDefaultWorkspace(page);
		},
		setup: [
			{ op: "openChat", title: "History 0" },
			{ op: "key", selector: testid("chat-input"), key: "r", code: "KeyR", ctrlKey: true },
			{ op: "wait", selector: testid("history-query") },
		],
		measured: [
			{ op: "type", selector: testid("history-query"), text: "needle", pauseMs: 120 },
			{ op: "wait", selector: testid("history-item"), hasText: "needle" },
			{ op: "key", selector: testid("history-query"), key: "ArrowUp", count: 25 },
		],
	},
	"rail-toggle": {
		seed: async (page) => {
			await createWorkspaceViaDialog(page);
		},
		setup: [{ op: "wait", selector: testid("tool-rail-files") }],
		measured: [{ op: "clickRepeat", selector: testid("tool-rail-files"), count: 20 }],
	},
} satisfies Record<string, Interaction>;

function wkHarness(): string {
	const binary = join(tmpdir(), "thinkrail-wk-harness");
	execFileSync("swiftc", [
		"-O",
		join(import.meta.dirname, "wkwebview/harness.swift"),
		"-o",
		binary,
	]);
	return binary;
}

function runInWebView(binary: string, url: string, interaction: Interaction): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-wk-"));
	const init = [
		`(${installRenderProfiler.toString()})({});`,
		...(interaction.resources
			? [`(${stubResourceWire.toString()})(${JSON.stringify(RESOURCE_STUB)});`]
			: []),
	].join("\n");
	const { setup, measured } = interaction;
	const drive = `(${driveInteraction.toString()})(${JSON.stringify({ setup, measured })})`;
	writeFileSync(join(dir, "init.js"), init);
	writeFileSync(join(dir, "drive.js"), drive);
	const out = join(dir, "out.json");
	try {
		execFileSync(binary, [url, join(dir, "init.js"), join(dir, "drive.js"), out], {
			timeout: WK_TIMEOUT_MS,
		});
		return readFileSync(out, "utf8");
	} catch (error) {
		const detail = (() => {
			try {
				return readFileSync(out, "utf8");
			} catch {
				return String(error);
			}
		})();
		throw new Error(`WKWebView run failed: ${detail}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function record(result: ScenarioRun): void {
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(join(OUT_DIR, `${result.scenario}-${result.run}.json`), JSON.stringify(result));
}

const NO_MAIN_THREAD = { taskMs: 0, scriptMs: 0, layoutMs: 0, styleMs: 0, heapDeltaMb: 0 };
let harness: string | undefined;

test.beforeEach(async ({ page, baseURL }) => {
	if (!baseURL) throw new Error("perf runs need a baseURL");
	await attachRenderProfiler(page, baseURL, {});
});

test.afterEach(async ({ page }) => {
	await detachRenderProfiler(page);
});

for (let run = 1; run <= RUNS; run += 1) {
	for (const [name, interaction] of Object.entries(INTERACTIONS) as [string, Interaction][]) {
		if (SELECTED && !SELECTED.includes(name)) continue;
		for (const engine of ENGINES) {
			test(`${name} ${engine} run ${run}`, async ({ page }) => {
				test.setTimeout(240_000);
				await openFixtureProject(page);
				await interaction.seed(page);
				const url = page.url();
				const { setup, measured } = interaction;
				if (engine === "chromium") {
					if (interaction.resources) await page.addInitScript(stubResourceWire, RESOURCE_STUB);
					await page.reload();
					const stop = await startMainThreadProbe(page, 1);
					const raw = await page.evaluate(driveInteraction, { setup, measured });
					const result = JSON.parse(raw) as Pick<ScenarioRun, "wallMs" | "profile">;
					const mainThread = await stop();
					record({ scenario: name, run, cpuRate: 1, counters: {}, mainThread, ...result });
					return;
				}
				await page.goto("about:blank");
				harness ??= wkHarness();
				const result = JSON.parse(runInWebView(harness, url, interaction)) as Pick<
					ScenarioRun,
					"wallMs" | "profile"
				> & { isolated: boolean };
				record({
					scenario: `${name}@wkwebview`,
					run,
					cpuRate: 1,
					counters: { isolated: result.isolated ? 1 : 0 },
					mainThread: NO_MAIN_THREAD,
					wallMs: result.wallMs,
					profile: result.profile,
				});
			});
		}
	}
}
