import { registerToolRenderer, registerToolRendererPrefix } from "../../toolRegistry";
import {
	McpReadResourceCard,
	McpResourceListCard,
	mcpListingSummary,
	mcpReadSummary,
} from "./McpResourceCards";
import { McpToolCard, mcpToolSummary } from "./McpToolCard";
import { MCP_TOOL_PREFIX } from "./mcpResult";
import { ToolSearchCard, toolSearchSummary } from "./ToolSearchCard";

registerToolRendererPrefix(MCP_TOOL_PREFIX, McpToolCard, { summary: mcpToolSummary });
registerToolRenderer("list_mcp_resources", McpResourceListCard, { summary: mcpListingSummary });
registerToolRenderer("list_mcp_resource_templates", McpResourceListCard, {
	summary: mcpListingSummary,
});
registerToolRenderer("read_mcp_resource", McpReadResourceCard, { summary: mcpReadSummary });
registerToolRenderer("tool_search", ToolSearchCard, { summary: toolSearchSummary });
