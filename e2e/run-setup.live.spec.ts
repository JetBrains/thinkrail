import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Project, RunRecipe, RunWorkspaceState } from "@thinkrail/contracts";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_RUN_PORT } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const RUNNABLE_README = `# sample-project

## Running

Start the dev server with \`python3 -m http.server "$PORT" --bind 127.0.0.1\` — it reads the PORT
environment variable (${E2E_RUN_PORT} by default). Run the tests with \`python3 test.py\`.
`;

function fixtureProjectId(): string {
	const projects = JSON.parse(
		readFileSync(join(E2E_DATA_DIR, "projects.json"), "utf8"),
	) as Project[];
	const project = projects[0];
	if (!project) throw new Error("The fixture project is not persisted");
	return project.id;
}

function makeRunnable(worktreePath: string): void {
	writeFileSync(join(worktreePath, "README.md"), RUNNABLE_README);
	writeFileSync(join(worktreePath, "test.py"), 'print("TR_TESTS_OK")\n');
}

async function waitForTurnEnd(page: Page): Promise<void> {
	const done = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });
	await expect(done.last()).toBeVisible({ timeout: 240_000 });
}

const primary = (page: Page) => page.getByTestId("scope-run-primary");
const status = (page: Page) => page.getByTestId("scope-run-status");

test("the agent learns a runnable project through running-the-project and the Run button then serves it", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	const workspace = await openWorkspaceChat(page);
	makeRunnable(workspace.worktreePath);
	await expect(primary(page)).toHaveAttribute("data-action", "setUp");

	await primary(page).click();
	await waitForTurnEnd(page);

	const projectId = fixtureProjectId();
	const wire = await E2eWire.connect();
	let recipe: RunRecipe | undefined;
	try {
		await expect
			.poll(async () => {
				const run = await wire.request("run.recipe", { projectId });
				recipe = run.document?.recipe;
				return recipe !== undefined;
			})
			.toBe(true);
	} finally {
		wire.close();
	}
	if (!recipe) throw new Error("no recipe");
	const serve = recipe.targets.find((target) => target.kind === "serve");
	expect(serve, "a serve target").toBeDefined();
	expect(Object.keys(recipe.ports).length).toBeGreaterThan(0);
	expect(serve?.ports?.length ?? 0).toBeGreaterThan(0);
	expect(serve?.url).toMatch(/^https?:\/\//);
	expect(serve?.command).not.toMatch(new RegExp(String(E2E_RUN_PORT)));
	expect(recipe.targets.some((target) => target.kind === "task")).toBe(true);

	await expect
		.poll(
			async () =>
				(await status(page).count()) === 0 ||
				!(await status(page).getAttribute("data-status"))?.match(
					/starting|running|listening|stopping/,
				),
			{ timeout: 60_000 },
		)
		.toBe(true);
	const primaryAction = await primary(page).getAttribute("data-action");
	if (primaryAction?.startsWith("start:")) await primary(page).click();
	await expect(status(page)).toHaveAttribute("data-status", "listening", { timeout: 60_000 });
	await expect(page.getByTestId("scope-run-open")).toBeVisible();
});

test("Fix with agent repairs a failing target so it runs again", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(300_000);
	const workspace = await openWorkspaceChat(page);
	makeRunnable(workspace.worktreePath);
	const projectId = fixtureProjectId();
	const wire = await E2eWire.connect();
	try {
		const current = await wire.request("run.recipe", { projectId });
		await wire.request("run.setRecipe", {
			projectId,
			recipe: {
				version: 1,
				ports: { PORT: E2E_RUN_PORT },
				prepare: [],
				targets: [{ id: "test", command: "python3 tests.py", kind: "task" }],
				primary: "test",
			} satisfies RunRecipe,
			expectedRevision: current.document?.revision ?? 0,
		});
	} finally {
		wire.close();
	}

	await expect(primary(page)).toHaveAttribute("data-action", "start:test:prepare");
	await primary(page).click();
	await expect(status(page)).toHaveAttribute("data-status", "exited", { timeout: 60_000 });
	await expect(primary(page)).toHaveAttribute("data-action", "fix");

	await primary(page).click();
	await waitForTurnEnd(page);

	const check = await E2eWire.connect();
	try {
		await expect
			.poll(
				async () => {
					const state: RunWorkspaceState = await check.request("run.state", {
						workspaceId: workspace.id,
					});
					const run = state.executions.find((execution) => execution.targetId === "test");
					if (run?.status === "exited" && run.exitCode === 0) return "ok";
					if (run && ["starting", "running", "stopping"].includes(run.status)) return "live";
					return "retry";
				},
				{ timeout: 60_000 },
			)
			.not.toBe("retry");
		const state: RunWorkspaceState = await check.request("run.state", {
			workspaceId: workspace.id,
		});
		const run = state.executions.find((execution) => execution.targetId === "test");
		if (run?.status !== "exited" || run.exitCode !== 0) {
			const primaryAction = await primary(page).getAttribute("data-action");
			if (primaryAction?.startsWith("start:")) await primary(page).click();
			await expect(status(page)).toHaveText("Finished", { timeout: 60_000 });
		}
	} finally {
		check.close();
	}
});
