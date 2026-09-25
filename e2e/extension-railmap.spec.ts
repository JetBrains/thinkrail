import { appendFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const GROUP = "extension-railmap";
const EXTENSION = "railmap";
const DEMO_DIR = "railmap-demo";
const BASE_TS = 1_700_700_000_000;

const spec = (id: string, dependsOn: string[]) =>
	`---\nid: ${id}\ntype: module-design\nstatus: active\ntitle: ${id} — railmap e2e module\ndepends-on: [${dependsOn.join(", ")}]\n---\n\n## Responsibility\n\nRailmap e2e fixture.\n`;

const DEMO: Record<string, string> = {
	"core/SPEC.md": spec("demo-core", []),
	"core/index.ts": 'export { value } from "./internal";\n',
	"core/internal.ts": "export const value = 1;\n",
	"api/SPEC.md": spec("demo-api", ["demo-core", "sample-module"]),
	"api/index.ts":
		'import { value } from "../core";\nimport { value as raw } from "../core/internal";\n\nexport const api = value + raw;\n',
	"ui/SPEC.md": spec("demo-ui", ["demo-core"]),
	"ui/index.ts":
		'import { api } from "../api";\nimport { value } from "../core";\n\nexport const ui = api + value;\n',
};

const writeDemo = () => {
	for (const [path, content] of Object.entries(DEMO)) {
		const target = join(E2E_FIXTURE_REPO, DEMO_DIR, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
};

const DRIFT_ITEM = {
	key: "undeclared:demo-ui>demo-api",
	kind: "undeclared",
	detail: "demo-ui → demo-api: 1 import (railmap-demo/ui/index.ts:1), no depends-on covers it",
	from: "demo-ui",
	to: "demo-api",
};

const seedChat = () => {
	const chat = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "railmap chat",
		messages: [
			{ role: "user", text: "May the UI import the API?", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "may-1",
						name: "may_import",
						arguments: { from: "railmap-demo/ui/index.ts", to: "../api" },
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "may-1",
				toolName: "may_import",
				content: [{ type: "text", text: "UNDECLARED: demo-ui → demo-api" }],
				details: {
					verdict: "undeclared",
					from: "demo-ui",
					to: "demo-api",
					reason: "No spec declares demo-ui → demo-api.",
				},
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	appendFileSync(
		chat.path,
		`${JSON.stringify({
			type: "custom_message",
			id: `${chat.id}-drift`,
			parentId: `${chat.id}-m2`,
			timestamp: new Date(BASE_TS + 3_000).toISOString(),
			customType: "railmap-drift",
			content: "Railmap: this run added 1 spec drift item",
			display: true,
			details: { root: E2E_FIXTURE_REPO, items: [DRIFT_ITEM] },
		})}\n`,
	);
};

const openRailmap = async (page: Page) => {
	await openFixtureProject(page);
	writeDemo();
	seedChat();
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
};

const openFromMenu = async (page: Page, surface: string) => {
	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${EXTENSION}-${surface}`).click();
};

test.use({ viewport: { width: 1600, height: 1000 } });

const node = (scope: Locator, id: string) =>
	scope.locator(`[data-testid="railmap-node"][data-id="${id}"]`);

test.afterEach(async () => {
	await removeExtension(EXTENSION);
	rmSync(join(E2E_FIXTURE_REPO, DEMO_DIR), { recursive: true, force: true });
});

test("railmap draws the spec graph, drills in, and lists drift", async ({ page }) => {
	await openRailmap(page);

	await openFromMenu(page, "graph");
	const graph = page.getByTestId("railmap-graph");
	await expect(graph.getByTestId("railmap-status")).toHaveAttribute("data-state", "ready");
	await expect(graph.getByTestId("railmap-node")).toHaveCount(4);
	await expect(node(graph, "demo-ui").getByTestId("railmap-node-drift")).toHaveText("1");
	await expect(graph.getByTestId("railmap-chip-undeclared")).toContainText("1");
	await expect(graph.getByTestId("railmap-chip-bypass")).toContainText("1");
	await shot(graph, GROUP, "07-railmap-graph");

	await node(graph, "demo-core").click();
	await expect(graph.getByTestId("railmap-affected").locator("li")).toHaveCount(2);
	await expect(node(graph, "demo-api")).toHaveAttribute("data-mark", "affected");
	await shot(graph, GROUP, "07-railmap-reverse-closure");

	await graph.locator('[data-testid="rf__edge-demo-ui>demo-api"]').click({ force: true });
	await expect(graph.getByTestId("railmap-sites")).toContainText("railmap-demo/ui/index.ts:1");
	await shot(graph, GROUP, "07-railmap-edge-sites");

	await node(graph, "demo-api").click();
	await graph.getByTestId("railmap-drill").click();
	await expect(node(graph, "file:railmap-demo/api/index.ts")).toBeVisible();
	await expect(node(graph, "demo-core")).toHaveAttribute("data-kind", "external");
	await expect(
		node(graph, "file:railmap-demo/api/index.ts").getByTestId("railmap-node-drift"),
	).toHaveText("1");
	await shot(graph, GROUP, "07-railmap-drill-in");

	await openFromMenu(page, "drift");
	const drift = page.getByTestId("railmap-drift");
	await expect(drift.getByTestId("railmap-drift-item")).toHaveCount(3);
	await expect(
		drift.locator('[data-testid="railmap-drift-item"][data-kind="bypass"]'),
	).toContainText("railmap-demo/core/internal.ts");
	await shot(drift, GROUP, "07-railmap-drift-panel");

	await drift.getByTestId("railmap-fix").first().click();
	await expect(page.getByTestId("chat-input")).toHaveValue(/Railmap found spec drift/);
});

test("railmap message and tool cards render from a seeded transcript", async ({ page }) => {
	await openRailmap(page);
	await openPersistedChat(page, "railmap chat");

	const tool = page.getByTestId("railmap-may-import");
	await expect(tool).toHaveAttribute("data-verdict", "undeclared");
	await expect(tool).toContainText("demo-ui → demo-api");
	const card = page.getByTestId("railmap-drift-card");
	await expect(card.getByTestId("railmap-drift-card-item")).toHaveCount(1);
	await expect(card).toContainText("demo-ui → demo-api");
	await shot(card, GROUP, "07-railmap-message-card");
	await shot(tool, GROUP, "07-railmap-tool-card");
});
