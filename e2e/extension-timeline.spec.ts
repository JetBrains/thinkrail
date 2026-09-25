import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const GROUP = "extension-timeline";
const EXTENSION = "timeline";
const BASE_TS = 1_700_600_000_000;

const usage = (total: number) => ({
	input: 12_000,
	output: 800,
	cacheRead: 4_000,
	cacheWrite: 0,
	totalTokens: 16_800,
	cost: { input: total / 2, output: total / 2, cacheRead: 0, cacheWrite: 0, total },
});

const settledRun = (sessionId: string) => {
	const span = (fields: Record<string, unknown>) => ({ sessionId, run: 1, ...fields });
	return {
		sessionId,
		live: false,
		run: 1,
		turn: 2,
		compactions: 1,
		dropped: 0,
		spans: [
			span({
				id: "r1t1",
				kind: "turn",
				name: "Turn 1",
				label: "e2e-model",
				start: BASE_TS,
				end: BASE_TS + 9_000,
				status: "ok",
				costUsd: 0.12,
				tokens: { in: 12_000, out: 800, cacheRead: 4_000 },
			}),
			span({
				id: "call-read",
				parentId: "r1t1",
				kind: "tool",
				name: "read",
				label: "src/index.ts",
				start: BASE_TS + 1_000,
				end: BASE_TS + 2_500,
				status: "ok",
				preview: "export const main = () => 42;",
			}),
			span({
				id: "call-bash",
				parentId: "r1t1",
				kind: "tool",
				name: "bash",
				label: "bun test",
				start: BASE_TS + 2_000,
				end: BASE_TS + 8_000,
				status: "ok",
				preview: "12 pass\n0 fail",
			}),
			span({
				id: "r1t2",
				kind: "turn",
				name: "Turn 2",
				label: "e2e-model",
				start: BASE_TS + 9_000,
				end: BASE_TS + 20_000,
				status: "ok",
				costUsd: 0.3,
			}),
			span({
				id: "call-edit",
				parentId: "r1t2",
				kind: "tool",
				name: "edit",
				label: "src/index.ts",
				start: BASE_TS + 10_000,
				end: BASE_TS + 11_000,
				status: "error",
				preview: "old text not found",
			}),
			span({
				id: "r1c1",
				kind: "compaction",
				name: "Compaction",
				label: "threshold · 148000 tokens before",
				start: BASE_TS + 20_000,
				end: BASE_TS + 23_000,
				status: "ok",
			}),
		],
	};
};

const seedChat = () =>
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "timeline chat",
		messages: [
			{ role: "user", text: "Run the tests.", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Tests pass.",
				usage: usage(0.12),
				timestamp: BASE_TS + 9_000,
			},
			{ role: "user", text: "Fix the edit.", timestamp: BASE_TS + 9_500 },
			{
				role: "assistant",
				text: "Done.",
				usage: usage(0.3),
				timestamp: BASE_TS + 20_000,
			},
		],
	});

const seedStore = (sessionId: string) => {
	const dir = join(E2E_DATA_DIR, "ext-store");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${EXTENSION}.json`),
		JSON.stringify({ sessions: [sessionId], [`timeline:${sessionId}`]: settledRun(sessionId) }),
	);
};

test.afterEach(() => removeExtension(EXTENSION));

test("the repo timeline extension shows a chat's settled run and pi's cost", async ({ page }) => {
	await openFixtureProject(page);
	seedStore(seedChat().id);
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
	await openPersistedChat(page, "timeline chat");

	const status = page.getByTestId("timeline-status");
	await expect(status).toContainText("$0.42");

	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${EXTENSION}-timeline`).click();
	const panel = page.getByTestId("timeline-panel");
	await expect(panel.getByTestId("timeline-run")).toHaveCount(1);
	await expect(panel.getByTestId("timeline-lane")).toHaveCount(3);
	await expect(panel.getByTestId("timeline-total")).toHaveText("$0.42 session");
	await expect(panel.locator('[data-testid="timeline-span"][data-status="error"]')).toHaveCount(1);

	await panel.locator('[data-testid="timeline-span"][data-kind="tool"]').nth(1).click();
	await expect(panel.getByTestId("timeline-preview")).toHaveText(/12 pass/);
	await shot(panel, GROUP, "00-panel-lanes");
	await shot(status, GROUP, "01-status");

	await panel.getByTestId("timeline-mode-flame").click();
	await expect(panel.getByTestId("timeline-flame-turn")).toHaveCount(2);
	await shot(panel, GROUP, "02-panel-flame");
});
