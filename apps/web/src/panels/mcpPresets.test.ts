import { expect, test } from "bun:test";
import {
	importIssues,
	mcpEntryErrors,
	mcpNameIssue,
	mcpSecretIssues,
	parseMcpServersJson,
	reviewMcpServer,
} from "./mcpEntries";
import { GITHUB_MCP_RECIPE_JSON, MCP_PRESETS } from "./mcpPresets";

test("presets are valid, pinned, credential-free entries with unique names", () => {
	expect(MCP_PRESETS.map((preset) => preset.id)).toEqual([
		"context7",
		"deepwiki",
		"linear",
		"sentry",
		"playwright",
	]);
	expect(new Set(MCP_PRESETS.map((preset) => preset.name)).size).toBe(MCP_PRESETS.length);
	for (const preset of MCP_PRESETS) {
		expect(mcpEntryErrors(preset.entry)).toEqual([]);
		expect(mcpNameIssue(preset.name, preset.scope, [])).toBeUndefined();
		expect(mcpSecretIssues(preset.entry)).toEqual([]);
		const { url, args } = preset.entry as { url?: string; args?: string[] };
		if (url) expect(url.startsWith("https://")).toBe(true);
		for (const arg of args ?? []) expect(arg).not.toMatch(/@latest$/);
	}
});

test("write-capable presets name what they can change, and the stdio preset is opt-in per project", () => {
	const byId = Object.fromEntries(MCP_PRESETS.map((preset) => [preset.id, preset]));
	expect(byId.context7?.modifiesData).toBeUndefined();
	expect(byId.deepwiki?.modifiesData).toBeUndefined();
	expect(byId.linear?.entry).toEqual({ url: "https://mcp.linear.app/mcp/readonly" });
	expect(byId.sentry?.modifiesData).toBe("Sentry");
	expect(byId.playwright).toMatchObject({
		scope: "user",
		optInPerProject: true,
		entry: { enabled: false },
	});
	expect(byId.playwright?.modifiesData).toBeDefined();
});

test("GitHub is a pasteable read-only recipe, not a preset, whose bearer header comes from gh auth token", () => {
	expect(MCP_PRESETS.some((preset) => preset.name === "github")).toBe(false);
	const parsed = parseMcpServersJson(GITHUB_MCP_RECIPE_JSON);
	if (!parsed.ok) throw new Error(parsed.error);
	const [server] = parsed.servers;
	if (!server) throw new Error("the recipe names no server");
	expect(parsed.servers).toHaveLength(1);
	expect(server.name).toBe("github");
	expect(server.entry).toEqual({
		url: "https://api.githubcopilot.com/mcp/readonly",
		headers: { Authorization: '!t=$(gh auth token) && echo "Bearer $t"' },
	});
	expect(importIssues(server, "user", [], ["github"])).toEqual([]);
	expect(reviewMcpServer(server.name, server.entry).runs).toEqual([
		{ label: "header Authorization", text: 't=$(gh auth token) && echo "Bearer $t"' },
	]);
});
