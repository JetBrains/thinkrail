import { RiFileTextLine, RiStackLine } from "@remixicon/react";
import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useFold } from "../../foldState";
import { McpActions, McpCliActionButton, useMcpFailureText } from "./McpActions";
import { McpHeader, McpOutput, McpRunning } from "./McpCardParts";
import {
	type McpListedItem,
	type McpListing,
	type McpListingError,
	mcpText,
	readMcpListing,
	readMcpToolDetails,
} from "./mcpResult";

const ROW_LIMIT = 20;

type ListingKind = "resources" | "templates";

const LISTING_TEXT = {
	resources: {
		empty: "mcp.listing.resources.empty",
		showAll: "mcp.listing.resources.showAll",
		more: "mcp.listing.resources.more",
		running: "mcp.listing.resources.running",
	},
	templates: {
		empty: "mcp.listing.templates.empty",
		showAll: "mcp.listing.templates.showAll",
		more: "mcp.listing.templates.more",
		running: "mcp.listing.templates.running",
	},
} as const satisfies Record<ListingKind, Record<string, MessageKey>>;

function listingServer(args: Record<string, unknown>, result: unknown): string {
	return strArg(args, "server") || readMcpToolDetails(result)?.server || "";
}

export function mcpListingSummary({ args, result }: ToolRenderProps, t: Translator): string {
	return listingServer(args, result) || t("mcp.listing.allServersSummary");
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
	kind,
}: {
	id: string;
	listing: McpListing;
	showServer: boolean;
	kind: ListingKind;
}) {
	const t = useT();
	const text = LISTING_TEXT[kind];
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
				<span className="text-text-muted italic">{t(text.empty)}</span>
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
					className="self-start rounded-xs text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
				>
					{all ? t("mcp.card.showFewer") : t(text.showAll, { count: listing.items.length })}
				</button>
			) : null}
			{listing.nextCursor ? <span className="text-text-muted">{t(text.more)}</span> : null}
			{listing.errors.map((entry) => (
				<ListingError key={`${entry.server}\u0000${entry.error}`} entry={entry} />
			))}
		</div>
	);
}

function ListingError({ entry }: { entry: McpListingError }) {
	const error = useMcpFailureText(entry.error, true);
	return (
		<div
			data-testid="mcp-listing-error"
			className="flex min-w-0 flex-wrap items-baseline gap-x-8 gap-y-2"
		>
			<span className="min-w-0 break-words text-feedback-error">
				{entry.server ? `${entry.server}: ${error}` : error}
			</span>
			<McpCliActionButton text={entry.error} />
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
	const t = useT();
	const server = listingServer(args, result);
	const kind: ListingKind = toolName === "list_mcp_resource_templates" ? "templates" : "resources";
	const listing = status === "done" ? readMcpListing(toolName, result) : null;
	const failed = status === "error";
	const raw = mcpText(result);
	const text = useMcpFailureText(raw, failed);
	return (
		<div data-testid={`tool-${toolName}`} className="flex min-w-0 flex-col gap-4">
			<McpHeader icon={<RiStackLine className="size-12 shrink-0 text-text-muted" />}>
				<span className={cn("min-w-0 truncate", server ? "text-primary" : "text-text-muted")}>
					{server || t("mcp.listing.allServers")}
				</span>
				{strArg(args, "cursor") ? (
					<span className="shrink-0 text-text-subtle">{t("mcp.listing.nextPage")}</span>
				) : null}
			</McpHeader>
			{status === "running" ? (
				<McpRunning label={t(LISTING_TEXT[kind].running)} />
			) : listing ? (
				<ListingView
					id={`${toolCallId}:listing`}
					listing={listing}
					showServer={!server}
					kind={kind}
				/>
			) : (
				<McpOutput id={`${toolCallId}:content`} text={text} result={result} failed={failed} />
			)}
			{status === "running" ? null : (
				<McpActions
					toolCallId={toolCallId}
					title={`${toolName} · ${server || t("mcp.listing.allServersSummary")}`}
					result={result}
					failureText={failed ? raw : ""}
				/>
			)}
		</div>
	);
}

export function McpReadResourceCard({
	toolCallId,
	toolName,
	args,
	result,
	status,
}: ToolRenderProps) {
	const t = useT();
	const server = listingServer(args, result);
	const uri = strArg(args, "uri");
	const failed = status === "error";
	const raw = mcpText(result);
	const text = useMcpFailureText(raw, failed);
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
				<McpRunning label={t("mcp.readResource.reading")} />
			) : (
				<>
					<McpOutput id={`${toolCallId}:content`} text={text} result={result} failed={failed} />
					<McpActions
						toolCallId={toolCallId}
						title={[server, uri].filter(Boolean).join(" · ") || toolName}
						result={result}
						failureText={failed ? raw : ""}
					/>
				</>
			)}
		</div>
	);
}
