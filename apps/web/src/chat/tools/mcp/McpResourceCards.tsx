import { RiFileTextLine, RiStackLine } from "@remixicon/react";
import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { cn } from "@thinkrail/ui/utils";
import { useFold } from "../../foldState";
import { McpActions, McpCliActionButton } from "./McpActions";
import { McpHeader, McpOutput, McpRunning } from "./McpCardParts";
import {
	type McpListedItem,
	type McpListing,
	mcpText,
	readMcpListing,
	readMcpToolDetails,
} from "./mcpResult";

const ROW_LIMIT = 20;

function listingServer(args: Record<string, unknown>, result: unknown): string {
	return strArg(args, "server") || readMcpToolDetails(result)?.server || "";
}

export function mcpListingSummary({ args, result }: ToolRenderProps): string {
	return listingServer(args, result) || "all servers";
}

export function mcpReadSummary({ args }: ToolRenderProps): string {
	return [strArg(args, "server"), strArg(args, "uri")].filter(Boolean).join(" · ");
}

function ListedRow({ item, showServer }: { item: McpListedItem; showServer: boolean }) {
	const meta = [item.uri, item.mimeType].filter(Boolean).join(" · ");
	return (
		<li
			data-testid="mcp-listed-item"
			className={cn("min-w-0", showServer && "col-span-2 grid grid-cols-subgrid")}
		>
			{showServer ? (
				<span data-testid="mcp-listed-server" className="truncate text-text-muted">
					{item.server}
				</span>
			) : null}
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-text-default" title={item.title ?? item.name}>
					{item.title ?? item.name}
				</span>
				<span className="truncate tr-code-text text-text-subtle" title={meta}>
					{meta}
				</span>
				{item.description ? (
					<span className="truncate text-text-muted" title={item.description}>
						{item.description}
					</span>
				) : null}
			</span>
		</li>
	);
}

function ListingView({
	id,
	listing,
	showServer,
	noun,
}: {
	id: string;
	listing: McpListing;
	showServer: boolean;
	noun: string;
}) {
	const [all, toggleAll, toggleRef] = useFold(`${id}:all`);
	const items = all ? listing.items : listing.items.slice(0, ROW_LIMIT);
	return (
		<div
			data-testid="mcp-listing"
			data-chat-fold-root
			data-expanded={all}
			className="flex min-w-0 flex-col gap-4 tr-text-metadata"
		>
			{listing.items.length === 0 ? (
				<span className="text-text-muted italic">No {noun}.</span>
			) : (
				<ul
					className={cn(
						"min-w-0 gap-y-4",
						showServer ? "grid grid-cols-[auto_minmax(0,1fr)] gap-x-12" : "flex flex-col",
					)}
				>
					{items.map((item) => (
						<ListedRow
							key={`${item.server}\u0000${item.uri}`}
							item={item}
							showServer={showServer}
						/>
					))}
				</ul>
			)}
			{listing.items.length > ROW_LIMIT ? (
				<button
					ref={toggleRef}
					type="button"
					aria-expanded={all}
					onClick={toggleAll}
					className="self-start rounded-[var(--radius-xs)] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
				>
					{all ? "Show fewer" : `Show all ${listing.items.length} ${noun}`}
				</button>
			) : null}
			{listing.nextCursor ? (
				<span className="text-text-muted">More {noun} on the next page.</span>
			) : null}
			{listing.errors.map((entry) => (
				<div
					key={`${entry.server}\u0000${entry.error}`}
					data-testid="mcp-listing-error"
					className="flex min-w-0 flex-wrap items-baseline gap-x-8 gap-y-2"
				>
					<span className="min-w-0 break-words text-feedback-error">
						{entry.server ? `${entry.server}: ${entry.error}` : entry.error}
					</span>
					<McpCliActionButton text={entry.error} />
				</div>
			))}
		</div>
	);
}

export function McpResourceListCard({
	toolCallId,
	toolName,
	args,
	result,
	status,
}: ToolRenderProps) {
	const server = listingServer(args, result);
	const noun = toolName === "list_mcp_resource_templates" ? "resource templates" : "resources";
	const listing = status === "done" ? readMcpListing(toolName, result) : null;
	const text = mcpText(result);
	const failed = status === "error";
	return (
		<div data-testid={`tool-${toolName}`} className="flex min-w-0 flex-col gap-4">
			<McpHeader icon={<RiStackLine className="size-12 shrink-0 text-text-muted" />}>
				<span className={cn("min-w-0 truncate", server ? "text-primary" : "text-text-muted")}>
					{server || "All servers"}
				</span>
				{strArg(args, "cursor") ? (
					<span className="shrink-0 text-text-subtle">next page</span>
				) : null}
			</McpHeader>
			{status === "running" ? (
				<McpRunning label={`Listing ${noun}…`} />
			) : listing ? (
				<ListingView
					id={`${toolCallId}:listing`}
					listing={listing}
					showServer={!server}
					noun={noun}
				/>
			) : (
				<McpOutput id={`${toolCallId}:content`} text={text} result={result} failed={failed} />
			)}
			{status === "running" ? null : (
				<McpActions
					toolCallId={toolCallId}
					title={`${toolName} · ${server || "all servers"}`}
					result={result}
					failureText={failed ? text : ""}
				/>
			)}
		</div>
	);
}

export function McpReadResourceCard({ toolCallId, args, result, status }: ToolRenderProps) {
	const server = listingServer(args, result);
	const uri = strArg(args, "uri");
	const text = mcpText(result);
	const failed = status === "error";
	return (
		<div data-testid="tool-read_mcp_resource" className="flex min-w-0 flex-col gap-4">
			<McpHeader icon={<RiFileTextLine className="size-12 shrink-0 text-text-muted" />}>
				{server ? <span className="shrink-0 text-primary">{server}</span> : null}
				{uri ? (
					<span className="min-w-0 truncate tr-code-text text-text-muted" title={uri}>
						{uri}
					</span>
				) : null}
			</McpHeader>
			{status === "running" ? (
				<McpRunning label="Reading the resource…" />
			) : (
				<>
					<McpOutput id={`${toolCallId}:content`} text={text} result={result} failed={failed} />
					<McpActions
						toolCallId={toolCallId}
						title={[server, uri].filter(Boolean).join(" · ") || "read_mcp_resource"}
						result={result}
						failureText={failed ? text : ""}
					/>
				</>
			)}
		</div>
	);
}
