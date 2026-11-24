import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiCheckboxBlankCircleFill as Dot,
	RiDeleteBin6Line as Forget,
	RiMore2Line as MoreVertical,
	RiRefreshLine as Reconnect,
	RiServerLine as Server,
	RiLoader4Line as Spinner,
	RiErrorWarningLine as Warning,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	type HostStatus,
	hostStatusOf,
	recoveryOf,
	type SavedHost,
} from "@thinkrail/remote-client";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { ProjectGlyph } from "@thinkrail/ui/project-tree";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useState } from "react";
import {
	appServers,
	type ServerProjects,
	serverFailureText,
	serverStatusText,
	useServers,
} from "../remote";
import { ConfirmDialog } from "./ConfirmDialog";

/** The saved servers under the local projects: each a row with its status, its projects beneath it. */
export function ServerList({ onAddServer }: { onAddServer: () => void }) {
	const { servers, statuses, projects } = useServers();
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	if (servers.length === 0) return null;
	const toggle = (hostKey: string): void =>
		setCollapsed((current) => {
			const next = new Set(current);
			if (!next.delete(hostKey)) next.add(hostKey);
			return next;
		});
	return (
		<ul data-testid="server-list" className="flex flex-col">
			{servers.map((server) => (
				<ServerGroup
					key={server.hostKey}
					server={server}
					status={hostStatusOf(statuses.get(server.hostKey))}
					projects={projects.get(server.hostKey)}
					expanded={!collapsed.has(server.hostKey)}
					onToggle={() => toggle(server.hostKey)}
					onAddServer={onAddServer}
				/>
			))}
		</ul>
	);
}

function ServerGroup({
	server,
	status,
	projects,
	expanded,
	onToggle,
	onAddServer,
}: {
	server: SavedHost;
	status: HostStatus;
	projects: ServerProjects | undefined;
	expanded: boolean;
	onToggle: () => void;
	onAddServer: () => void;
}) {
	const t = useT();
	const [confirmForget, setConfirmForget] = useState(false);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const reconnect = (): void => appServers().reconnect(server.hostKey);
	return (
		<li data-testid="server-group" data-status={status.kind}>
			<div
				data-testid="server-item"
				data-row
				className="group flex h-panel-row items-center gap-4 rounded-sm pr-4 pl-4 transition-colors hover:bg-control-bg-hovered"
			>
				<button
					type="button"
					data-testid="server-toggle"
					aria-expanded={expanded}
					aria-label={t(expanded ? "panels.servers.collapse" : "panels.servers.expand", {
						name: server.label,
					})}
					onClick={onToggle}
					className="-mx-4 -my-2 flex min-w-0 flex-1 items-center gap-4 rounded-sm px-4 py-2 text-left focus-visible:focus-ring-inset"
				>
					<Chevron aria-hidden className="size-16 shrink-0 text-text-muted" />
					<Server aria-hidden className="size-14 shrink-0 text-text-muted" />
					<span data-testid="server-name" className="truncate tr-text-ui text-text-default">
						{server.label}
					</span>
				</button>
				<StatusMark status={status} label={serverStatusText(t, status)} />
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<IconButton
							icon={MoreVertical}
							label={t("panels.servers.serverActions", { name: server.label })}
							variant="ghost"
							size="s"
							className="shrink-0"
							data-testid="server-actions"
						/>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem data-testid="server-menu-reconnect" onSelect={reconnect}>
							<Reconnect />
							<span>{t("panels.servers.reconnect")}</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							data-testid="server-menu-forget"
							onSelect={() => setConfirmForget(true)}
						>
							<Forget />
							<span>{t("panels.servers.forget")}</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{expanded ? (
				<>
					{status.kind === "unreachable" ? (
						<ServerFailure
							text={serverFailureText(t, status.failure)}
							recovery={recoveryOf(status.failure)}
							onReconnect={reconnect}
							onAddAgain={onAddServer}
						/>
					) : null}
					<ServerProjectRows projects={projects} status={status} />
				</>
			) : null}
			<ConfirmDialog
				open={confirmForget}
				onOpenChange={setConfirmForget}
				title={t("panels.servers.forgetTitle", { name: server.label })}
				description={t("panels.servers.forgetDescription")}
				confirmLabel={t("panels.servers.forget")}
				confirmTestId="confirm-forget-server"
				onConfirm={() => appServers().forget(server.hostKey)}
			/>
		</li>
	);
}

/** Connected, on its way, or down — the words are the mark's tooltip and its accessible name. */
function StatusMark({ status, label }: { status: HostStatus; label: string }) {
	const common = { role: "img", "aria-label": label, "data-testid": "server-status" } as const;
	if (status.kind === "connected")
		return (
			<span {...common} title={label} className="flex size-16 shrink-0 items-center justify-center">
				<Dot aria-hidden className="size-8 text-feedback-success" />
			</span>
		);
	if (status.kind === "connecting")
		return (
			<span {...common} title={label} className="flex size-16 shrink-0 items-center justify-center">
				<Spinner aria-hidden className="size-14 text-text-muted motion-safe:animate-spin" />
			</span>
		);
	return (
		<span {...common} title={label} className="flex size-16 shrink-0 items-center justify-center">
			<Warning aria-hidden className="size-14 text-feedback-warning" />
		</span>
	);
}

function ServerFailure({
	text,
	recovery,
	onReconnect,
	onAddAgain,
}: {
	text: string;
	recovery: "repair" | "reconnect" | "none";
	onReconnect: () => void;
	onAddAgain: () => void;
}) {
	const t = useT();
	return (
		<div data-testid="server-failure" className="flex flex-col items-start gap-4 py-4 pr-8 pl-24">
			<p className="tr-text-metadata text-feedback-warning">{text}</p>
			{recovery === "reconnect" ? (
				<Button size="s" variant="outline" onClick={onReconnect} data-testid="server-reconnect">
					{t("panels.servers.reconnect")}
				</Button>
			) : recovery === "repair" ? (
				<Button size="s" variant="outline" onClick={onAddAgain} data-testid="server-add-again">
					{t("panels.servers.addAgain")}
				</Button>
			) : null}
		</div>
	);
}

function ServerProjectRows({
	projects,
	status,
}: {
	projects: ServerProjects | undefined;
	status: HostStatus;
}) {
	const t = useT();
	if (!projects || projects.kind === "loading")
		return status.kind === "unreachable" ? null : (
			<LoadingRegion rows={2} className="py-4 pr-8 pl-24" />
		);
	if (projects.kind === "failed")
		return (
			<p className="py-4 pr-8 pl-24 tr-text-metadata text-text-muted">
				{t("panels.servers.projectsFailed", { message: projects.message })}
			</p>
		);
	if (projects.projects.length === 0)
		return (
			<p className="py-4 pr-8 pl-24 tr-text-metadata text-text-muted">
				{t("panels.servers.noProjects")}
			</p>
		);
	return (
		<ul>
			{projects.projects.map((project) => (
				<li
					key={project.id}
					data-testid="server-project"
					title={project.path}
					className="flex h-panel-row items-center gap-4 rounded-sm pr-4 pl-24"
				>
					<ProjectGlyph selected={false} running={false} />
					<span className="truncate tr-text-ui text-text-muted">{project.name}</span>
				</li>
			))}
		</ul>
	);
}
