import { RiPlugLine } from "@remixicon/react";
import type { McpServerResourceSummary } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { type McpStateTone, mcpStateTone, mcpStatusLabel } from "@/lib";
import type { ResourceActions } from "./resourceRow";

type McpRowActionId = "disable" | "enable" | "reconnect" | "settings";

type McpRowAction = { id: McpRowActionId; label: MessageKey };

const DISABLE = { id: "disable", label: "resources.mcp.disable" } as const satisfies McpRowAction;

export function mcpRowActions(server: McpServerResourceSummary): McpRowAction[] {
	const actions = stateActions(server.state);
	return server.registered ? actions.filter((action) => action.id !== DISABLE.id) : actions;
}

function stateActions(state: McpServerResourceSummary["state"]): McpRowAction[] {
	switch (state) {
		case "disabled-in-chat":
			return [{ id: "enable", label: "resources.mcp.enable" }];
		case "needs-sign-in":
			return [{ id: "settings", label: "resources.mcp.signIn" }, DISABLE];
		case "failed":
		case "disconnected":
			return [{ id: "reconnect", label: "resources.mcp.reconnect" }, DISABLE];
		case "pending-approval":
			return [{ id: "settings", label: "resources.mcp.review" }];
		case "invalid-config":
			return [{ id: "settings", label: "common.edit" }];
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
	const t = useT();
	const tone = mcpStateTone(server.state, server.toolCount);
	const action = actions[mcpActionKey(server.name)];
	return (
		<li
			data-testid="resource-mcp"
			data-name={server.name}
			data-state={server.state}
			className="grid min-h-32 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-8 rounded-sm px-8 py-4 hover:bg-control-bg-hovered"
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
						{mcpStatusLabel(t, server.state, server.toolCount)}
					</span>
				</span>
				<span className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 text-text-muted tr-text-metadata">
					<span>
						{server.transport === "http" ? t("mcp.transport.http") : t("resources.mcp.stdioOnHost")}
						{server.state === "pending-reload" ? ` · ${t("resources.mcp.pendingReload")}` : ""}
					</span>
					{mcpRowActions(server).map((item) => (
						<Button
							key={item.id}
							variant="soft-primary"
							size="s"
							data-testid={`resource-mcp-${item.id}`}
							aria-describedby={item.id === "disable" ? describedBy : undefined}
							disabled={!authoritative || !!action?.pending}
							onClick={() => onAction(item.id)}
						>
							{t(item.label)}
						</Button>
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
	onOpenSettings,
}: {
	servers: McpServerResourceSummary[];
	authoritative: boolean;
	actions: ResourceActions;
	onSetEnabled: (name: string, enabled: boolean) => void;
	onReconnect: (name: string) => void;
	onOpenSettings: () => void;
}) {
	const t = useT();
	const hintId = useId();
	return (
		<section
			data-testid="resources-mcp"
			aria-label={t("resources.mcp.title")}
			className="flex flex-col gap-2"
		>
			<div className="flex items-baseline gap-4 px-8 pt-8 pb-2 text-text-subtle">
				<h3 className="tr-text-eyebrow">{t("resources.mcp.title")}</h3>
				<span className="tr-text-metadata">· {servers.length}</span>
				<span className="flex-1" />
				<Button
					variant="soft-primary"
					size="s"
					data-testid="resources-mcp-settings"
					onClick={onOpenSettings}
				>
					{t("resources.mcp.settings")}
				</Button>
			</div>
			{servers.length === 0 ? (
				<p className="px-8 py-4 text-text-subtle tr-text-metadata">{t("resources.mcp.empty")}</p>
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
									if (id === "settings") onOpenSettings();
									else if (id === "reconnect") onReconnect(server.name);
									else onSetEnabled(server.name, id === "enable");
								}}
							/>
						))}
					</ul>
					<p id={hintId} className="px-8 text-text-subtle tr-text-metadata">
						{t("resources.mcp.disableHint")}
					</p>
				</>
			)}
		</section>
	);
}
