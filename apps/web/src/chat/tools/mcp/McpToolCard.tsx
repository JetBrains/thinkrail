import { RiPlugLine } from "@remixicon/react";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { McpActions, useMcpFailureText } from "./McpActions";
import { McpArgs, McpHeader, McpOutput, McpRunning, McpServerTool } from "./McpCardParts";
import { McpStructuredContent } from "./McpJsonTree";
import { mcpArgsSummary, mcpCallTitle, mcpText, readMcpResultSummary } from "./mcpResult";

export function mcpToolSummary({ args }: ToolRenderProps): string {
	return mcpArgsSummary(args);
}

export function McpToolCard({ toolCallId, toolName, args, result, status }: ToolRenderProps) {
	const { server, tool } = mcpCallTitle(toolName, result);
	const summary = readMcpResultSummary(result);
	const failed = status === "error" || summary?.isError === true;
	const text = mcpText(result);
	const shown = useMcpFailureText(text, failed);
	return (
		<div
			data-testid="tool-mcp"
			data-server={server}
			data-mcp-tool={tool}
			className="flex min-w-0 flex-col gap-4"
		>
			<McpHeader icon={<RiPlugLine className="size-12 shrink-0 text-text-muted" />}>
				<McpServerTool server={server} tool={tool} />
			</McpHeader>
			<McpArgs id={`${toolCallId}:args`} args={args} />
			{status === "running" ? (
				<McpRunning label={text.trim().split("\n").at(-1) || `Calling ${tool || toolName}…`} />
			) : (
				<>
					<McpOutput id={`${toolCallId}:content`} text={shown} result={result} failed={failed} />
					<McpStructuredContent id={`${toolCallId}:structured`} summary={summary} />
					<McpActions
						toolCallId={toolCallId}
						title={server && tool ? `${server} / ${tool}` : toolName}
						result={result}
						failureText={failed ? text : ""}
					/>
				</>
			)}
		</div>
	);
}
