import { RiPlugLine } from "@remixicon/react";
import type { McpServerResourceSummary } from "@thinkrail/contracts";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { type McpStateTone, mcpStateTone, mcpStatusLabel } from "@/lib";
import type { ResourceActions } from "./resourceRow";

type McpRowActionId = "disable" | "enable" | "reconnect";

const DISABLE = { id: "disable", label: "Disable in this chat" } as const;

export function mcpRowActions(
	server: McpServerResourceSummary,
): { id: McpRowActionId; label: string }[] {
	const actions = stateActions(server.state);
	return server.registered ? actions.filter((action) => action.id !== DISABLE.id) : actions;
}

function stateActions(
	state: McpServerResourceSummary["state"],
): { id: McpRowActionId; label: string }[] {
	switch (state) {
		case "disabled-in-chat":
			return [{ id: "enable", label: "Enable in this chat" }];
		case "failed":
		case "disconnected":
			return [{ id: "reconnect", label: "Reconnect" }, DISABLE];
		case "needs-sign-in":
		case "connected":
		case "starting":
		case "unknown":
			return [DISABLE];
		default:
			return [];
	}
}

const STATE_TEXT: Record<McpStateTone, string> = {
	success: "text-feedback-success",
	working: "text-primary",
	warning: "text-feedback-warning",
	error: "text-feedback-error",
	info: "text-feedback-info",
	neutral: "text-text-subtle",
};

const STATE_DOT: Record<McpStateTone, string> = {
	success: "bg-feedback-success",
	working: "bg-primary motion-safe:animate-working",
	warning: "bg-feedback-warning",
	error: "bg-feedback-error",
	info: "bg-feedback-info",
	neutral: "bg-text-subtle",
};

function mcpActionKey(name: string): string {
	return `mcp:${name}`;
}

function McpRow({
	server,
	authoritative,
	actions,
	describedBy,
	onAction,
}: {
	server: McpServerResourceSummary;
	authoritative: boolean;
	actions: ResourceActions;
	describedBy: string;
	onAction: (id: McpRowActionId) => void;
}) {
	const tone = mcpStateTone(server.state, server.toolCount);
	const action = actions[mcpActionKey(server.name)];
	return (
		<li
			data-testid="resource-mcp"
			data-name={server.name}
			data-state={server.state}
			className="grid min-h-32 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-8 rounded-[var(--radius-sm)] px-8 py-4 hover:bg-control-bg-hovered"
		>
			<span className="relative mt-2 inline-flex size-16 shrink-0 items-center justify-center">
				<RiPlugLine className="size-14 text-text-muted" />
				<span
					aria-hidden
					className={cn(
						"-right-2 -bottom-2 absolute size-6 rounded-full ring-2 ring-container-elevated-bg",
						STATE_DOT[tone],
					)}
				/>
			</span>
			<span className="flex min-w-0 flex-col gap-2">
				<span className="flex min-w-0 items-baseline gap-8">
					<span
						className="min-w-0 flex-1 truncate tr-title-compact text-text-default"
						title={server.name}
					>
						{server.name}
					</span>
					<span
						data-testid="resource-mcp-state"
						className={cn("whitespace-nowrap tr-text-metadata", STATE_TEXT[tone])}
					>
						{mcpStatusLabel(server.state, server.toolCount)}
					</span>
				</span>
				<span className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 text-text-muted tr-text-metadata">
					<span>
						{server.transport === "http" ? "HTTP" : "stdio · runs on host"}
						{server.state === "pending-reload" ? " · applies when the chat is idle" : ""}
					</span>
					{mcpRowActions(server).map((item) => (
						<button
							key={item.id}
							type="button"
							data-testid={`resource-mcp-${item.id}`}
							aria-describedby={item.id === "disable" ? describedBy : undefined}
							disabled={!authoritative || !!action?.pending}
							onClick={() => onAction(item.id)}
							className="rounded-[var(--radius-xs)] px-4 text-primary outline-none hover:bg-control-bg focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text disabled:hover:bg-transparent"
						>
							{item.label}
						</button>
					))}
				</span>
				{action?.error ? (
					<span role="alert" className="break-words text-feedback-error tr-text-metadata">
						{action.error}
					</span>
				) : null}
			</span>
		</li>
	);
}

export function McpServerSection({
	servers,
	authoritative,
	actions,
	onSetEnabled,
	onReconnect,
}: {
	servers: McpServerResourceSummary[];
	authoritative: boolean;
	actions: ResourceActions;
	onSetEnabled: (name: string, enabled: boolean) => void;
	onReconnect: (name: string) => void;
}) {
	const hintId = useId();
	return (
		<section data-testid="resources-mcp" aria-label="MCP servers" className="flex flex-col gap-2">
			<div className="flex items-baseline gap-4 px-8 pt-8 pb-2 text-text-subtle">
				<h3 className="tr-text-eyebrow">MCP servers</h3>
				<span className="tr-text-metadata">· {servers.length}</span>
			</div>
			{servers.length === 0 ? (
				<p className="px-8 py-4 text-text-subtle tr-text-metadata">No MCP servers in this chat.</p>
			) : (
				<>
					<ul className="flex flex-col gap-2">
						{servers.map((server) => (
							<McpRow
								key={server.name}
								server={server}
								authoritative={authoritative}
								actions={actions}
								describedBy={hintId}
								onAction={(id) => {
									if (id === "reconnect") onReconnect(server.name);
									else onSetEnabled(server.name, id === "enable");
								}}
							/>
						))}
					</ul>
					<p id={hintId} className="px-8 text-text-subtle tr-text-metadata">
						Disabling applies when the chat is idle — restarts this chat's other servers.
					</p>
				</>
			)}
		</section>
	);
}
