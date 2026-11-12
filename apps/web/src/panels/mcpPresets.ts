import type { McpServerEntryInput, McpServerScope } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";

export interface McpPreset {
	id: string;
	name: string;
	title: MessageKey;
	description: MessageKey;
	entry: McpServerEntryInput;
	scope: McpServerScope;
	modifiesData?: MessageKey;
	optInPerProject?: boolean;
}

export const MCP_PRESETS: readonly McpPreset[] = [
	{
		id: "context7",
		name: "context7",
		title: "mcp.preset.context7.title",
		description: "mcp.preset.context7.description",
		entry: { url: "https://mcp.context7.com/mcp", exposure: "direct" },
		scope: "user",
	},
	{
		id: "deepwiki",
		name: "deepwiki",
		title: "mcp.preset.deepwiki.title",
		description: "mcp.preset.deepwiki.description",
		entry: { url: "https://mcp.deepwiki.com/mcp", exposure: "direct" },
		scope: "user",
	},
	{
		id: "linear",
		name: "linear",
		title: "mcp.preset.linear.title",
		description: "mcp.preset.linear.description",
		entry: { url: "https://mcp.linear.app/mcp/readonly" },
		scope: "user",
	},
	{
		id: "sentry",
		name: "sentry",
		title: "mcp.preset.sentry.title",
		description: "mcp.preset.sentry.description",
		entry: { url: "https://mcp.sentry.dev/mcp" },
		scope: "user",
		modifiesData: "mcp.preset.sentry.modifiesData",
	},
	{
		id: "playwright",
		name: "playwright",
		title: "mcp.preset.playwright.title",
		description: "mcp.preset.playwright.description",
		entry: { command: "npx", args: ["-y", "@playwright/mcp@0.0.83"], enabled: false },
		scope: "user",
		modifiesData: "mcp.preset.playwright.modifiesData",
		optInPerProject: true,
	},
];

export const GITHUB_MCP_RECIPE_JSON = JSON.stringify(
	{
		mcpServers: {
			github: {
				url: "https://api.githubcopilot.com/mcp/readonly",
				headers: { Authorization: '!t=$(gh auth token) && echo "Bearer $t"' },
			},
		},
	},
	null,
	2,
);
