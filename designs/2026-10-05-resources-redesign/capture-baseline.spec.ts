import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { SessionResources, WsClientMessage, WsParams } from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "../../e2e/fixtures/app";
import { E2E_FIXTURE_REPO } from "../../e2e/fixtures/paths";
import { shot } from "../../e2e/fixtures/screenshots";
import { seedWorkspaceSession } from "../../e2e/fixtures/sessions";

async function openResourceChat(page: Page) {
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Resource UI",
		messages: [{ role: "user", text: "Inspect this chat's resources.", timestamp: Date.now() }],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Resource UI");
	await expect(page.getByTestId("chat-toolbar")).toBeVisible();
}

async function populate(page: Page) {
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && frame.method === "session.resources") {
				const scope = frame.params as WsParams<"session.resources">;
				const now = Date.now();
				const result: SessionResources = {
					...scope,
					commands: [
						{
							id: "cmd-1",
							sessionId: scope.sessionId,
							name: "vite dev server",
							command: "bun run dev:web --port 5173",
							status: "running",
							startedAt: now - 4 * 60_000,
						},
						{
							id: "cmd-2",
							sessionId: scope.sessionId,
							name: "unit tests (watch)",
							command: "bun test --watch apps/web/src/chat",
							status: "stopping",
							startedAt: now - 90_000,
						},
						{
							id: "cmd-3",
							sessionId: scope.sessionId,
							name: "typecheck",
							command: "turbo run typecheck",
							status: "completed",
							startedAt: now - 10 * 60_000,
							finishedAt: now - 8 * 60_000,
							exitCode: 0,
						},
						{
							id: "cmd-4",
							sessionId: scope.sessionId,
							name: "e2e shard",
							command: "bun run e2e -- e2e/chat-resources.spec.ts",
							status: "error",
							startedAt: now - 20 * 60_000,
							finishedAt: now - 15 * 60_000,
							exitCode: 1,
							errorMessage: "Process exited with code 1",
						},
					],
					subagents: [
						{
							childSessionId: "child-1",
							parentSessionId: scope.sessionId,
							roleName: "scout",
							task: "Find every call site of registerToolRenderer and summarise the renderer contract",
							status: "running",
							createdAt: new Date(now - 2 * 60_000).toISOString(),
						},
						{
							childSessionId: "child-2",
							parentSessionId: scope.sessionId,
							roleName: "reviewer",
							task: "Review the diff of apps/web/src/chat/resources against the SPEC",
							status: "queued",
							createdAt: new Date(now - 30_000).toISOString(),
						},
						{
							childSessionId: "child-3",
							parentSessionId: scope.sessionId,
							roleName: "worker",
							task: "Add dark/light screenshots to the mockup page",
							status: "completed",
							createdAt: new Date(now - 12 * 60_000).toISOString(),
						},
					],
				};
				browser.send(JSON.stringify({ id: frame.id, ok: true, result }));
				return;
			}
			server.send(message);
		});
		server.onMessage((message) => browser.send(message));
	});
}

test("baseline screenshots of the populated Resources popover", async ({ page }) => {
	await populate(page);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openResourceChat(page);
	const trigger = page.getByTestId("resources-trigger");
	await expect(trigger).toHaveAttribute("data-active-count", "4");
	await shot(page.getByTestId("chat-toolbar"), "baseline", "header-dark");
	await shot(page, "baseline", "page-dark");
	await trigger.click();
	const popover = page.getByTestId("resources-popover");
	await expect(popover).toBeVisible();
	await shot(popover, "baseline", "popover-dark");
	await shot(page, "baseline", "page-popover-dark");
	await popover.getByTestId("resources-finished-toggle").click();
	await shot(popover, "baseline", "popover-finished-dark");
	await popover.getByTestId("resource-logs").first().click();
	await page.waitForTimeout(600);
	await shot(page, "baseline", "page-logs-dark");
	await page.keyboard.press("Escape");

	await page.setViewportSize({ width: 390, height: 844 });
	await trigger.click();
	await expect(popover).toBeVisible();
	await shot(page, "baseline", "mobile-popover-dark");
});
