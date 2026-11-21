import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openSettingsSection } from "./fixtures/app";
import { resolveBunExecutable } from "./fixtures/executables";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { unreachedInSection } from "./fixtures/settingsTree";

const USER_MCP_CONFIG = join(E2E_PI_AGENT_DIR, "mcp.json");
const STDIO_SERVER = fileURLToPath(
	new URL("../packages/server/src/agent/mcp/fixtures/stdioServer.ts", import.meta.url),
);

test("every button, link and field in every section is reachable with the arrows and Enter", async ({
	page,
}) => {
	test.setTimeout(600_000);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openSettingsSection(page, "appearance");
	const sections = await page
		.locator('[data-testid^="settings-nav-"][role="tab"]')
		.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-testid")?.slice(13) ?? ""));
	expect(sections.length).toBeGreaterThan(10);
	const report: Record<string, string[]> = {};
	for (const section of sections) {
		const missing = await unreachedInSection(page, section);
		if (missing.length > 0) report[section] = missing;
	}
	expect(report).toEqual({});
});

test("a section's list rows and their buttons are reachable too: MCP with servers, without a workspace", async ({
	page,
}) => {
	const entry = { command: resolveBunExecutable(), args: [STDIO_SERVER], enabled: false };
	writeFileSync(
		USER_MCP_CONFIG,
		JSON.stringify({ mcpServers: { "tree-alpha": entry, "tree-beta": entry } }),
	);
	try {
		await openFixtureProject(page);
		await openSettingsSection(page, "mcp");
		await expect(page.getByTestId("mcp-server-row")).toHaveCount(2);
		expect(await unreachedInSection(page, "mcp")).toEqual([]);
		expect(await unreachedInSection(page, "templates")).toEqual([]);
	} finally {
		rmSync(USER_MCP_CONFIG, { force: true });
	}
});
