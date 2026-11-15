import { RiPlugLine } from "@remixicon/react";
import type { McpServerResourceSummary } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useId } from "react";
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

export function mcpResourceId(name: string): string {
	return `mcp:${name}`;
}

function McpGlyph({ server }: { server: McpServerResourceSummary }) {
	return (
		<span className="relative inline-flex size-16 shrink-0 items-center justify-center">
			<RiPlugLine className="size-14 text-text-muted" />
			<span
				aria-hidden
				className={cn(
					"-right-2 -bottom-2 absolute size-6 rounded-full ring-2 ring-container-elevated-bg",
					STATE_DOT[mcpStateTone(server.state, server.toolCount)],
				)}
			/>
		</span>
	);
}

function McpStateText({ server }: { server: McpServerResourceSummary }) {
	const t = useT();
	return (
		<span
			data-testid="resource-mcp-state"
			className={cn(
				"whitespace-nowrap tr-text-metadata",
				STATE_TEXT[mcpStateTone(server.state, server.toolCount)],
			)}
		>
			{mcpStatusLabel(t, server.state, server.toolCount)}
		</span>
	);
}

function transportLabel(t: Translator, server: McpServerResourceSummary): string {
	return server.transport === "http" ? t("mcp.transport.http") : t("resources.mcp.stdioOnHost");
}

function McpOption({
	server,
	selected,
	onSelect,
}: {
	server: McpServerResourceSummary;
	selected: boolean;
	onSelect: () => void;
}) {
	const t = useT();
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onSelect();
		}
	};
	return (
		<div
			role="none"
			data-testid="resource-mcp"
			data-name={server.name}
			data-state={server.state}
			data-resource-id={mcpResourceId(server.name)}
			data-selected={selected || undefined}
			className={cn(
				"min-h-32 min-w-0 rounded-sm px-8 py-4 hover:bg-control-bg-hovered",
				selected && "bg-control-bg-selected",
			)}
		>
			<div
				role="option"
				aria-selected={selected}
				aria-label={t("resources.row.accessibleName", {
					name: server.name,
					activity: transportLabel(t, server),
					state: mcpStatusLabel(t, server.state, server.toolCount),
				})}
				tabIndex={0}
				onClick={onSelect}
				onKeyDown={onKeyDown}
				className="flex min-w-0 cursor-default items-center gap-8 rounded-sm focus-visible:focus-ring"
			>
				<McpGlyph server={server} />
				<span
					className="min-w-0 flex-1 truncate tr-title-compact text-text-default"
					title={server.name}
				>
					{server.name}
				</span>
				<McpStateText server={server} />
			</div>
		</div>
	);
}

export function McpServerSection({
	servers,
	selectedId,
	onSelect,
	onOpenSettings,
}: {
	servers: McpServerResourceSummary[];
	selectedId: string | null;
	onSelect: (resourceId: string) => void;
	onOpenSettings: () => void;
}) {
	const t = useT();
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
				servers.map((server) => (
					<McpOption
						key={server.name}
						server={server}
						selected={mcpResourceId(server.name) === selectedId}
						onSelect={() => onSelect(mcpResourceId(server.name))}
					/>
				))
			)}
		</section>
	);
}

export function McpDetailHeader({
	server,
	authoritative,
	actions,
	onSetEnabled,
	onReconnect,
	onOpenSettings,
}: {
	server: McpServerResourceSummary;
	authoritative: boolean;
	actions: ResourceActions;
	onSetEnabled: (name: string, enabled: boolean) => void;
	onReconnect: (name: string) => void;
	onOpenSettings: () => void;
}) {
	const t = useT();
	const hintId = useId();
	const action = actions[mcpResourceId(server.name)];
	const offered = mcpRowActions(server);
	const onAction = (id: McpRowActionId) => {
		if (id === "settings") onOpenSettings();
		else if (id === "reconnect") onReconnect(server.name);
		else onSetEnabled(server.name, id === "enable");
	};
	return (
		<div
			data-testid="resource-mcp-detail"
			data-name={server.name}
			className="flex shrink-0 flex-col gap-8 border-border-muted border-b p-12"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-8">
				<McpGlyph server={server} />
				<span className="min-w-0 truncate tr-title-dialog" title={server.name}>
					{server.name}
				</span>
				<McpStateText server={server} />
				<span className="flex-1" />
				{offered.map((item) => (
					<Button
						key={item.id}
						variant="outline"
						size="m"
						data-testid={`resource-mcp-${item.id}`}
						aria-describedby={item.id === "disable" || item.id === "enable" ? hintId : undefined}
						disabled={!authoritative || !!action?.pending}
						onClick={() => onAction(item.id)}
					>
						{t(item.label)}
					</Button>
				))}
			</div>
			<dl className="flex flex-wrap gap-x-16 gap-y-4 text-text-muted tr-text-metadata">
				<div className="flex gap-4">
					<dt className="text-text-default">{t("resources.detail.transport")}</dt>
					<dd>{transportLabel(t, server)}</dd>
				</div>
				{server.registered ? (
					<div className="flex gap-4">
						<dd>{t("resources.mcp.registered")}</dd>
					</div>
				) : null}
				{server.state === "pending-reload" ? (
					<div className="flex gap-4">
						<dd>{t("resources.mcp.pendingReload")}</dd>
					</div>
				) : null}
			</dl>
			{action?.error ? (
				<p role="alert" className="break-words text-feedback-error tr-text-metadata">
					{action.error}
				</p>
			) : null}
			{offered.some((item) => item.id === "disable" || item.id === "enable") ? (
				<p id={hintId} className="text-text-subtle tr-text-metadata">
					{t("resources.mcp.disableHint")}
				</p>
			) : null}
		</div>
	);
}
