import { appendFileSync, realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import {
	DEMO_EXTENSION,
	demoSource,
	installDemoExtension,
	invokeDemoAction,
	reloadDemoExtension,
	removeDemoExtension,
	writeDemoFile,
} from "./fixtures/extensions";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const GROUP = "extensions";
const PANEL_TOOL = `ext:${DEMO_EXTENSION}:side`;
const BASE_TS = 1_700_500_000_000;

function seedSlotChat(name: string) {
	const chat = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: "Probe the demo.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "probe-1", name: "demo_probe", arguments: { query: "alpha" } },
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "probe-1",
				toolName: "demo_probe",
				content: [{ type: "text", text: "probed" }],
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	appendFileSync(
		chat.path,
		`${JSON.stringify({
			type: "custom_message",
			id: `${chat.id}-note`,
			parentId: `${chat.id}-m2`,
			timestamp: new Date(BASE_TS + 3_000).toISOString(),
			customType: "e2e-demo-note",
			content: "drift found",
			display: true,
			details: { level: "warn" },
		})}\n`,
	);
	return chat;
}

async function openDemoWorkspace(page: Page, beforeEnter?: () => void): Promise<void> {
	await openFixtureProject(page);
	beforeEnter?.();
	await enterDefaultWorkspace(page);
	installDemoExtension();
	expect((await reloadDemoExtension()).status).toBe("active");
}

async function openSurfaceFromMenu(page: Page, surface: string): Promise<void> {
	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${DEMO_EXTENSION}-${surface}`).click();
}

test.afterEach(() => removeDemoExtension());

test("an extension mounts in a panel, a tab, and the topbar with live channels and actions", async ({
	page,
}) => {
	await openDemoWorkspace(page);
	const badge = page.getByTestId("demo-badge");
	await expect(badge).toHaveText("demo 0");

	await openSurfaceFromMenu(page, "side");
	await expect(page.getByTestId(`tab-${PANEL_TOOL}`)).toContainText("Demo panel");
	const count = page.getByTestId("demo-count");
	await expect(count).toHaveText("count 0");
	await expect(page.locator("link[data-ext-stylesheet]")).not.toHaveCount(0);

	await invokeDemoAction("bump", 3);
	await expect(count).toHaveText("count 3");
	await expect(badge).toHaveText("demo 3");

	await page.getByTestId("demo-bump").click();
	await expect(count).toHaveText("count 5");
	await page.getByTestId("demo-echo").click();
	await expect(page.getByTestId("demo-reply")).toContainText('"payload":"ping"');
	await expect(page.getByTestId("demo-reply")).not.toContainText('"workspace":null');

	await openSurfaceFromMenu(page, "board");
	const board = page.getByTestId("demo-board");
	await expect(board).toBeVisible();
	await expect(page.getByTestId("demo-board-count")).toHaveText("count 5");
	await expect(page.getByTestId("demo-board-workspace")).toHaveText("workspace attached");
	await expect(
		page
			.locator('[data-testid="editor-tab"][data-kind="extension"]')
			.filter({ hasText: "Demo board" }),
	).toHaveCount(1);

	await openSurfaceFromMenu(page, "board");
	await expect(page.locator('[data-kind="extension"]')).toHaveCount(1);

	await shot(page, GROUP, "00-panel-tab-status");
	await shot(page.getByTestId("demo-side"), GROUP, "01-panel");
	await shot(board, GROUP, "02-tab");
	await shot(page.getByTestId("ext-status-items"), GROUP, "03-status");
});

test("a reload swaps the view in place and a broken reload keeps the last working view", async ({
	page,
}) => {
	await openDemoWorkspace(page);
	await openSurfaceFromMenu(page, "side");
	const version = page.getByTestId("demo-version");
	await expect(version).toHaveText("Demo panel v1");
	await page.evaluate(() => Reflect.set(window, "__extReloadMarker", "kept"));

	writeDemoFile("side.tsx", demoSource("side.tsx").replace("Demo panel v1", "Demo panel v2"));
	const swapped = await reloadDemoExtension();
	expect(swapped.status).toBe("active");
	await expect(version).toHaveText("Demo panel v2");
	await expect(page.locator(`[data-testid="ext-surface"][data-surface="side"]`)).toHaveAttribute(
		"data-build",
		swapped.build ?? "",
	);
	expect(await page.evaluate(() => Reflect.get(window, "__extReloadMarker"))).toBe("kept");

	writeDemoFile("side.tsx", "export default function Side() { return <div>{</div>; }\n");
	const broken = await reloadDemoExtension();
	expect(broken.status).toBe("error");
	expect(broken.generation).toBe(swapped.generation);
	expect(broken.build).toBe(swapped.build);
	await expect(version).toHaveText("Demo panel v2");
	const banner = page
		.getByTestId("ext-surface-error")
		.filter({ hasText: "Reload failed; showing the last working version" });
	await expect(banner.first()).toBeVisible();
	await expect(banner.first()).toContainText("side.tsx");
	expect(await page.evaluate(() => Reflect.get(window, "__extReloadMarker"))).toBe("kept");
	await shot(
		page.locator('[data-testid="ext-surface"][data-surface="side"]'),
		GROUP,
		"04-broken-reload",
	);
});

test("a restored layout keeps a placeholder for an extension that is not loaded", async ({
	page,
}) => {
	await openDemoWorkspace(page);
	await openSurfaceFromMenu(page, "side");
	await openSurfaceFromMenu(page, "board");
	await expect(page.getByTestId("demo-board")).toBeVisible();

	await removeDemoExtension();
	const placeholder = page
		.getByTestId("ext-surface-placeholder")
		.filter({ hasText: `extension ${DEMO_EXTENSION} not loaded` });
	await expect(placeholder.first()).toBeVisible();
	await expect(page.getByTestId("demo-badge")).toHaveCount(0);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId(`tab-${PANEL_TOOL}`)).toBeVisible();
	await expect(page.locator('[data-kind="extension"]')).toHaveCount(1);
	await expect(placeholder.first()).toBeVisible();
});

test("toolCard and message surfaces render a chat's tool call and custom message", async ({
	page,
}) => {
	await openDemoWorkspace(page, () => seedSlotChat("extension slot chat"));
	await openPersistedChat(page, "extension slot chat");

	const probe = page.getByTestId("demo-probe");
	await expect(probe).toBeVisible();
	await expect(page.getByTestId("demo-probe-query")).toHaveText("probe alpha");
	await expect(page.getByTestId("demo-probe-status")).toHaveText("done");

	const note = page.getByTestId("demo-note");
	await expect(note).toBeVisible();
	await expect(page.getByTestId("demo-note-text")).toHaveText("drift found");
	await expect(page.getByTestId("demo-note-level")).toHaveText("warn");
	await shot(probe, GROUP, "05-tool-card");
	await shot(note, GROUP, "06-message");
});
