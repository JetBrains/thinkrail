import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const GROUP = "extension-ultracode";
const EXTENSION = "ultracode";
const BASE_TS = 1_701_000_000_000;
const STORE = join(E2E_DATA_DIR, "ext-store", `${EXTENSION}.json`);

const usage = (cost: number, turns = 2) => ({
	input: 18_000 * turns,
	output: 900 * turns,
	cacheRead: 4_000,
	cacheWrite: 0,
	cost,
	turns,
});

interface SeedAgent {
	label: string;
	phaseIndex: number;
	state: "done" | "failed" | "aborted";
	start: number;
	end: number;
	cost: number;
	output?: string;
	result?: unknown;
	error?: string;
}

const agentRow = (agent: SeedAgent, index: number) => ({
	index,
	label: agent.label,
	phaseIndex: agent.phaseIndex,
	state: agent.state,
	attempt: 1,
	queuedAt: BASE_TS + agent.start,
	startedAt: BASE_TS + agent.start,
	endedAt: BASE_TS + agent.end,
	prompt: `Review the ${agent.label.split(":")[1]} area for concrete security bugs. Reply with findings only.`,
	usage: usage(agent.cost),
	childId: `child-${index}`,
	model: "openai-codex/gpt-5.6-terra",
	...(agent.output ? { output: agent.output } : {}),
	...(agent.result ? { result: agent.result } : {}),
	...(agent.error ? { error: agent.error } : {}),
});

const FINDINGS = {
	findings: [
		{
			file: "src/auth/session.ts",
			line: 42,
			severity: "high",
			issue: "refresh token never expires",
		},
	],
};

const SWEEP = {
	runId: "uc_e2esweep01",
	name: "security-sweep",
	description: "Parallel security sweep with independent verification",
	status: "completed",
	parentSessionId: "seed-parent",
	startedAt: BASE_TS,
	endedAt: BASE_TS + 96_000,
	phases: [
		{ index: 0, title: "Map", detail: "reviewers scan different areas" },
		{ index: 1, title: "Verify", detail: "independent confirmation" },
		{ index: 2, title: "Report" },
	],
	agents: [
		{
			label: "map:auth",
			phaseIndex: 0,
			state: "done",
			start: 0,
			end: 31_000,
			cost: 0.041,
			result: FINDINGS,
		},
		{
			label: "map:api",
			phaseIndex: 0,
			state: "done",
			start: 0,
			end: 27_000,
			cost: 0.036,
			result: { findings: [] },
		},
		{
			label: "map:db",
			phaseIndex: 0,
			state: "done",
			start: 0,
			end: 38_000,
			cost: 0.044,
			result: { findings: [] },
		},
		{
			label: "map:billing",
			phaseIndex: 0,
			state: "failed",
			start: 0,
			end: 45_000,
			cost: 0.012,
			error: "agent failed: schema validation failed: findings[0].line: must be integer",
		},
		{
			label: "verify:session.ts",
			phaseIndex: 1,
			state: "done",
			start: 38_500,
			end: 70_000,
			cost: 0.052,
			result: { confirmed: true },
		},
		{
			label: "verify:tokens.ts",
			phaseIndex: 1,
			state: "done",
			start: 38_500,
			end: 64_000,
			cost: 0.047,
			result: { confirmed: false },
		},
		{
			label: "report",
			phaseIndex: 2,
			state: "done",
			start: 70_500,
			end: 96_000,
			cost: 0.029,
			output: "1 confirmed high-severity finding in src/auth/session.ts.",
		},
	].map((agent, index) => agentRow(agent as SeedAgent, index)),
	logs: [
		"▸ Map",
		"✓ map:auth  40k tok  $0.04  31s",
		"✗ map:billing  agent failed",
		"▸ Verify",
		"▸ Report",
		"• 1 finding confirmed",
	],
	limits: { concurrency: 6, maxAgents: 1000, maxCost: 0.5 },
	result: { confirmed: 1 },
};

const MIGRATION = {
	runId: "uc_e2emigr002",
	name: "api-migration",
	description: "Staged migration, cancelled by the user",
	status: "aborted",
	parentSessionId: "seed-parent",
	startedAt: BASE_TS + 200_000,
	endedAt: BASE_TS + 230_000,
	phases: [{ index: 0, title: "Migrate" }],
	agents: [
		agentRow(
			{
				label: "migrate:users",
				phaseIndex: 0,
				state: "done",
				start: 200_000,
				end: 221_000,
				cost: 0.03,
				output: "done",
			},
			0,
		),
		agentRow(
			{
				label: "migrate:orders",
				phaseIndex: 0,
				state: "aborted",
				start: 200_000,
				end: 230_000,
				cost: 0.02,
				error: "agent was cancelled",
			},
			1,
		),
	],
	logs: ["▸ Migrate"],
	limits: { concurrency: 4, maxAgents: 1000 },
};

const summaryOf = (run: typeof SWEEP) => ({
	runId: run.runId,
	name: run.name,
	status: run.status,
	parentSessionId: run.parentSessionId,
	startedAt: run.startedAt,
	endedAt: run.endedAt,
	counts: { total: 7, queued: 0, running: 0, done: 6, failed: 1, aborted: 0, replayed: 0 },
	cost: 0.261,
	maxCost: 0.5,
});

const seedStore = () => {
	mkdirSync(join(E2E_DATA_DIR, "ext-store"), { recursive: true });
	writeFileSync(STORE, JSON.stringify({ runs: [MIGRATION, SWEEP] }));
};

const clearStore = () => rmSync(STORE, { force: true });

const seedChat = () =>
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "workflow chat",
		messages: [
			{ role: "user", text: "Sweep the repo for security bugs", timestamp: BASE_TS - 2_000 },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "wf-1",
						name: "Ultracode",
						arguments: {
							script: "export const meta = { name: 'security-sweep', description: 'x' }\nreturn 1",
						},
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS - 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "wf-1",
				toolName: "Ultracode",
				content: [
					{ type: "text", text: 'Workflow "security-sweep" completed — 7 agents (1 failed)' },
				],
				details: summaryOf(SWEEP),
				isError: false,
				timestamp: BASE_TS + 97_000,
			},
		],
	});

const openFromMenu = async (page: Page, surface: string) => {
	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${EXTENSION}-${surface}`).click();
};

test.use({ viewport: { width: 1600, height: 1100 } });

test.beforeEach(seedStore);

test.afterEach(async () => {
	await removeExtension(EXTENSION);
	clearStore();
});

test("ultracode lists runs, opens a run tab with phases and agent details, and forgets a run", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");

	await expect(page.getByTestId("ultracode-status")).toBeHidden();
	await openFromMenu(page, "workflows");
	const panel = page.getByTestId("ultracode-workflows");
	const rows = panel.getByTestId("ultracode-row");
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toHaveAttribute("data-status", "aborted");
	await expect(rows.nth(1)).toContainText("security-sweep");
	await expect(rows.nth(1)).toContainText("7/7 agents");
	await expect(rows.nth(1)).toContainText("1 failed");
	await expect(rows.nth(1).getByTestId("ultracode-cost")).toContainText("$0.26 / $0.50");
	await shot(panel, GROUP, "11-ultracode-panel");

	await rows.nth(1).getByTestId("ultracode-row-open").click();
	const run = page.getByTestId("ultracode-run");
	await expect(run).toHaveAttribute("data-status", "completed");
	await expect(run.getByTestId("ultracode-run-name")).toHaveText("security-sweep");
	await expect(run.getByTestId("ultracode-phase")).toHaveCount(3);
	await expect(run.getByTestId("ultracode-agent")).toHaveCount(7);
	await expect(run.locator('[data-testid="ultracode-agent"][data-state="failed"]')).toHaveCount(1);
	await expect(run.getByTestId("ultracode-cancel")).toBeHidden();
	await shot(run, GROUP, "11-ultracode-run");

	await run.getByTestId("ultracode-agent").first().click();
	const detail = run.getByTestId("ultracode-agent-detail");
	await expect(detail.getByTestId("ultracode-agent-result")).toContainText(
		"refresh token never expires",
	);
	await expect(detail.getByTestId("ultracode-agent-prompt")).toContainText("auth area");
	await shot(run, GROUP, "11-ultracode-agent-detail");

	await run.locator('[data-testid="ultracode-agent"][data-state="failed"]').click();
	await expect(detail).toHaveAttribute("data-state", "failed");
	await expect(detail.getByTestId("ultracode-agent-error")).toContainText("must be integer");
	await detail.getByTestId("ultracode-agent-close").click();
	await expect(detail).toBeHidden();

	await openFromMenu(page, "workflows");
	await rows.nth(0).getByTestId("ultracode-row-forget").click();
	await expect(rows).toHaveCount(1);
	await shot(page, GROUP, "11-ultracode-app");
});

test("the Ultracode tool card renders from a seeded transcript and opens the run", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedChat();
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
	await openPersistedChat(page, "workflow chat");

	const card = page.getByTestId("ultracode-card");
	await expect(card).toHaveAttribute("data-state", "completed");
	await expect(card.getByTestId("ultracode-card-name")).toHaveText("security-sweep");
	await expect(card.getByTestId("ultracode-card-agents")).toHaveText("7/7 agents");
	await expect(card).toContainText("1 failed");
	await shot(card, GROUP, "11-ultracode-tool-card");

	await card.getByTestId("ultracode-card-open").click();
	await expect(page.getByTestId("ultracode-run-name")).toHaveText("security-sweep");
});
