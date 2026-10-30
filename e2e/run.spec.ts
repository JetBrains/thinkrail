import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Project, RunRecipe } from "@thinkrail/contracts";
import { isPortFree } from "@thinkrail/shared/freePort";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	openWorkspaceMenu,
	visibleTerminalScreen,
	worktreeRows,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_RUN_PORT } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const RECIPE: RunRecipe = {
	version: 1,
	ports: { PORT: E2E_RUN_PORT },
	prepare: ["echo TR_PREPARED"],
	targets: [
		{
			id: "dev",
			command: 'python3 -m http.server "$PORT" --bind 127.0.0.1',
			kind: "serve",
			ports: ["PORT"],
			url: `http://localhost:\${PORT}/`,
		},
		{ id: "test", command: "echo TR_TESTED; exit 3", kind: "task" },
	],
	primary: "dev",
};

function fixtureProjectId(): string {
	const projects = JSON.parse(
		readFileSync(join(E2E_DATA_DIR, "projects.json"), "utf8"),
	) as Project[];
	const project = projects[0];
	if (!project) throw new Error("The fixture project is not persisted");
	return project.id;
}

async function seedRecipe(recipe: RunRecipe = RECIPE): Promise<string> {
	const projectId = fixtureProjectId();
	const wire = await E2eWire.connect();
	try {
		const current = await wire.request("run.recipe", { projectId });
		await wire.request("run.setRecipe", {
			projectId,
			recipe,
			expectedRevision: current.document?.revision ?? 0,
		});
	} finally {
		wire.close();
	}
	return projectId;
}

const primary = (page: Page) => page.getByTestId("scope-run-primary");
const status = (page: Page) => page.getByTestId("scope-run-status");
const runTab = (page: Page) => page.getByTestId("terminal-tab").filter({ hasText: "Run: dev" });

async function runFromMenu(page: Page, action: string): Promise<void> {
	await page.getByTestId("scope-run-menu").click();
	await page
		.getByTestId("scope-run-action")
		.and(page.locator(`[data-action="${action}"]`))
		.click();
}

test("the Run segment offers set-up, runs the primary target to listening, stops it, and surfaces a failed one-shot", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await expect(primary(page)).toHaveAttribute("data-action", "setUp");

	await seedRecipe();
	await expect(primary(page)).toHaveAttribute("data-action", "start:dev:prepare");

	await primary(page).click();
	await expect(status(page)).toHaveAttribute("data-status", "listening", { timeout: 30_000 });
	await expect(status(page)).toContainText(`:${E2E_RUN_PORT}`);
	await expect(page.getByTestId("scope-run-open")).toBeVisible();
	await expect(runTab(page)).toBeVisible();
	await expect(visibleTerminalScreen(page)).toContainText("TR_PREPARED");
	await expect(visibleTerminalScreen(page)).toContainText("Serving HTTP");
	expect(await isPortFree(E2E_RUN_PORT)).toBe(false);

	await expect(primary(page)).toHaveAttribute("data-action", "stop:dev");
	await primary(page).click();
	await expect(status(page)).toHaveAttribute("data-status", "stopped", { timeout: 30_000 });
	await expect.poll(() => isPortFree(E2E_RUN_PORT)).toBe(true);
	await expect(page.getByTestId("run-terminal-footer")).toHaveAttribute("data-status", "stopped");

	await runFromMenu(page, "start:test:prepare");
	await expect(status(page)).toHaveAttribute("data-status", "exited", { timeout: 30_000 });
	await expect(status(page)).toHaveText("Exited 3");
	await expect(primary(page)).toHaveAttribute("data-action", "fix");
	const footer = page.getByTestId("run-terminal-footer");
	await expect(footer).toHaveAttribute("data-status", "exited");
	await expect(page.getByTestId("terminal-tab").filter({ hasText: "Run: test" })).toBeVisible();

	await page.getByTestId("run-terminal-again").click();
	await expect(status(page)).toHaveAttribute("data-status", "starting");
	await expect(status(page)).toHaveAttribute("data-status", "exited", { timeout: 30_000 });
	await expect(visibleTerminalScreen(page)).toContainText("TR_TESTED");
});

test("the Run tab lists targets, validates a hand edit on the host, and keeps the project switches", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("tool-rail-run").click();
	await expect(page.getByTestId("run-panel-empty")).toBeVisible();

	const projectId = await seedRecipe();
	await expect(page.getByTestId("run-target")).toHaveCount(2);
	await expect(
		page.getByTestId("run-target-primary").and(page.locator('[data-primary="true"]')),
	).toHaveCount(1);

	await page.getByTestId("run-panel-edit").click();
	const editor = page.getByTestId("run-recipe-text");
	await editor.fill(JSON.stringify({ ...RECIPE, primary: "nope" }, null, 2));
	await page.getByTestId("run-recipe-save").click();
	await expect(page.getByTestId("run-recipe-errors")).toContainText("primary");

	await editor.fill(
		JSON.stringify(
			{
				...RECIPE,
				targets: [{ ...RECIPE.targets[0], title: "Dev server" }, RECIPE.targets[1]],
			},
			null,
			2,
		),
	);
	await page.getByTestId("run-recipe-save").click();
	await expect(page.getByTestId("run-recipe-editor")).toHaveCount(0);
	await expect(page.getByTestId("run-target").first()).toContainText("Dev server");

	await page.getByTestId("run-panel-auto-open").click();
	const wire = await E2eWire.connect();
	try {
		await expect
			.poll(async () => (await wire.request("run.recipe", { projectId })).settings.autoOpen)
			.toBe(true);
	} finally {
		wire.close();
	}
});

test("a second client sees the run without placing its terminal, and removing the workspace stops the server", async ({
	page,
	context,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page)).toHaveCount(1);
	await seedRecipe();
	await expect(primary(page)).toHaveAttribute("data-action", "start:dev:prepare");
	await primary(page).click();
	await expect(status(page)).toHaveAttribute("data-status", "listening", { timeout: 30_000 });
	const worktreePort = E2E_RUN_PORT + 1;
	await expect(status(page)).toContainText(`:${worktreePort}`);
	await expect(runTab(page)).toBeVisible();

	const second = await context.newPage();
	await second.goto("/");
	await expect(second.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await worktreeRows(second).first().click();
	await expect(status(second)).toHaveAttribute("data-status", "listening", { timeout: 30_000 });
	await expect(runTab(second)).toHaveCount(0);
	await second.close();

	await openWorkspaceMenu(worktreeRows(page).first());
	await page.getByTestId("workspace-remove").click();
	await page.getByTestId("confirm-remove").click();
	await expect(worktreeRows(page)).toHaveCount(0);
	await expect.poll(() => isPortFree(worktreePort), { timeout: 30_000 }).toBe(true);
});

test("a Windows host shows no Run segment and the Run tab explains", async ({ page }) => {
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		const server = ws.connectToServer();
		ws.onMessage((message) => server.send(message));
		server.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as {
					channel?: string;
					data?: { hostPlatform?: string };
				};
				if (frame.channel === "server.welcome" && frame.data) {
					frame.data.hostPlatform = "win32";
					ws.send(JSON.stringify(frame));
					return;
				}
			} catch {}
			ws.send(message);
		});
	});
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("scope-run-segment")).toHaveCount(0);
	await page.getByTestId("tool-rail-run").click();
	await expect(page.getByTestId("run-panel-unavailable")).toContainText("Windows");
});
