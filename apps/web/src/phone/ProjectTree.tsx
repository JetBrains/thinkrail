import { RiAddLine, RiArrowDownSLine, RiArrowRightSLine, RiComputerLine } from "@remixicon/react";
import {
	DEFAULT_CONFIG,
	DEFAULT_WORKSPACE_NAME,
	type Project,
	partitionWorkspaces,
	type Workspace,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import type {
	DeviceWireClient,
	RemoteSessionItem,
	RemoteSessionsController,
	SavedHost,
} from "@thinkrail/remote-client";
import { AttentionDot } from "@thinkrail/ui/attention-dot";
import { IconButton } from "@thinkrail/ui/button";
import { ProjectGlyph, WorkspaceBranch, WorkspaceGlyph } from "@thinkrail/ui/project-tree";
import { RunningIcon } from "@thinkrail/ui/running-icon";
import { cn } from "@thinkrail/ui/utils";
import { useNow } from "../components/useNow";
import type { PairState } from "./App";
import { HostBanner } from "./HostBanner";
import { failureText, type HostStatus } from "./hostStatus";
import { useHostAccess, useHostClient, useHostWelcome } from "./hostView";
import { LoadedList } from "./layout";
import { scopeStatus } from "./status";
import { HostActions, ProjectActions, type ReportFailure, WorkspaceActions } from "./TreeActions";
import { useHostRequest } from "./useHostRequest";

const PROJECT_PUSHES = [WS_CHANNELS.projectUpdated];
const WORKSPACE_PUSHES = [
	WS_CHANNELS.workspaceCreated,
	WS_CHANNELS.workspaceUpdated,
	WS_CHANNELS.workspaceRemoved,
];

export function workspaceName(t: Translator, workspace: Workspace): string {
	return workspace.kind === "default" && workspace.name === DEFAULT_WORKSPACE_NAME
		? t("store.workspace.defaultName")
		: workspace.name;
}

const expansionKey = (hostKey: string, projectId: string) => `${hostKey}:${projectId}`;

/** A paired computer as the tree's top level: name and whether it is reachable, ⋯ to reconnect or forget it; open, it shows why it is unreachable and the fix, else its open projects. */
export function HostTree({
	host,
	status,
	controller,
	items,
	pair,
	onPair,
	open,
	onToggleOpen,
	expanded,
	onToggle,
	onReconnect,
	onForget,
	onFailure,
	onNewWorktree,
	onOpen,
}: {
	host: SavedHost;
	status: HostStatus;
	controller: RemoteSessionsController;
	/** This computer's sessions. */
	items: RemoteSessionItem[];
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	open: boolean;
	onToggleOpen: () => void;
	/** Expanded projects, keyed `hostKey:projectId`, kept by the app so returning from a chat keeps the tree. */
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onReconnect: () => void;
	onForget: () => void;
	onFailure: ReportFailure;
	onNewWorktree: (project: Project) => void;
	onOpen: (project: Project, workspace: Workspace) => void;
}) {
	const t = useT();
	const access = useHostAccess(controller, host.hostKey);
	const marks = scopeStatus(items, () => true);
	const Chevron = open ? RiArrowDownSLine : RiArrowRightSLine;
	return (
		<li data-testid="computer" className="border-b border-border-muted">
			<div className="flex items-center pr-4">
				<button
					type="button"
					aria-expanded={open}
					onClick={onToggleOpen}
					className="flex min-h-touch min-w-0 flex-1 items-center gap-8 border-0 bg-transparent py-8 pl-12 text-left active:bg-control-bg-hovered"
				>
					<Chevron aria-hidden className="size-20 shrink-0 text-text-muted" />
					{marks.running ? (
						<RunningIcon className="size-22 text-primary" />
					) : (
						<RiComputerLine aria-hidden className="size-22 shrink-0 text-text-muted" />
					)}
					<span className="flex min-w-0 flex-1 flex-col gap-2">
						<span className="truncate text-text-default tr-title-card">{host.label}</span>
						<span
							className={cn(
								"truncate tr-text-metadata",
								status.kind === "unreachable" ? "text-feedback-warning" : "text-text-subtle",
							)}
						>
							{status.kind === "connected"
								? access === "read"
									? `${t("mobile.hosts.connected")} · ${t("mobile.hosts.readOnly")}`
									: t("mobile.hosts.connected")
								: status.kind === "connecting"
									? t("mobile.hosts.connecting")
									: failureText(t, status.failure)}
						</span>
					</span>
					{marks.attention ? <AttentionDot /> : null}
				</button>
				<HostActions host={host} onReconnect={onReconnect} onForget={onForget} />
			</div>
			{open ? (
				status.kind === "unreachable" ? (
					<HostBanner
						failure={status.failure}
						pair={pair}
						onPair={onPair}
						onReconnect={onReconnect}
					/>
				) : (
					<HostProjects
						host={host}
						controller={controller}
						items={items}
						expanded={expanded}
						onToggle={onToggle}
						onFailure={onFailure}
						onOpen={onOpen}
						onNewWorktree={onNewWorktree}
					/>
				)
			) : null}
		</li>
	);
}

/** A muted line inside the tree at a given depth: a wait (with the running mark) or an empty level. */
function TreeNote({
	text,
	depth,
	pending = false,
}: {
	text: string;
	depth: "project" | "workspace";
	pending?: boolean;
}) {
	return (
		<div
			role="status"
			className={cn(
				"flex min-h-touch items-center gap-12 pr-12 text-text-muted tr-text-reading",
				depth === "project" ? "pl-40" : "pl-64",
			)}
		>
			{pending ? <RunningIcon className="size-20 text-primary" /> : null}
			{text}
		</div>
	);
}

function HostProjects({
	host,
	controller,
	items,
	expanded,
	onToggle,
	onFailure,
	onOpen,
	onNewWorktree,
}: {
	host: SavedHost;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onFailure: ReportFailure;
	onOpen: (project: Project, workspace: Workspace) => void;
	onNewWorktree: (project: Project) => void;
}) {
	const t = useT();
	const client = useHostClient(controller, host.hostKey);
	const loaded = useHostRequest<Project[]>(client, "project.list", {}, "", PROJECT_PUSHES);
	const open =
		loaded.kind === "ready" ? { ...loaded, value: loaded.value.filter((p) => !p.closed) } : loaded;

	return (
		<div className="pb-4">
			<LoadedList
				loaded={open}
				empty={<TreeNote depth="project" text={t("mobile.projects.empty")} />}
				loading={<TreeNote depth="project" pending text={t("mobile.list.loading")} />}
			>
				{(projects) =>
					projects.map((project) => {
						const key = expansionKey(host.hostKey, project.id);
						return (
							<ProjectRow
								key={project.id}
								host={host}
								project={project}
								client={client}
								controller={controller}
								items={items}
								expanded={expanded.has(key)}
								onToggle={() => onToggle(key)}
								onFailure={onFailure}
								onOpen={(workspace) => onOpen(project, workspace)}
								onNewWorktree={() => onNewWorktree(project)}
							/>
						);
					})
				}
			</LoadedList>
		</div>
	);
}

/** A project row: tap to expand; **+** creates a worktree off the default branch and opens it, ⋯ holds the project menu. */
function ProjectRow({
	host,
	project,
	client,
	controller,
	items,
	expanded,
	onToggle,
	onFailure,
	onOpen,
	onNewWorktree,
}: {
	host: SavedHost;
	project: Project;
	client: DeviceWireClient | null;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	expanded: boolean;
	onToggle: () => void;
	onFailure: ReportFailure;
	onOpen: (workspace: Workspace) => void;
	onNewWorktree: () => void;
}) {
	const t = useT();
	const status = scopeStatus(items, (item) => item.record.projectId === project.id);
	const Chevron = expanded ? RiArrowDownSLine : RiArrowRightSLine;
	const readOnly = useHostAccess(controller, host.hostKey) === "read";
	return (
		<li>
			<div className="flex items-center pr-4">
				<button
					type="button"
					aria-expanded={expanded}
					onClick={onToggle}
					className="flex min-h-touch min-w-0 flex-1 items-center gap-8 border-0 bg-transparent py-8 pl-40 text-left active:bg-control-bg-hovered"
				>
					<Chevron aria-hidden className="size-20 shrink-0 text-text-muted" />
					<ProjectGlyph selected={false} running={status.running} className="size-22" />
					<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">
						{project.name}
					</span>
					{status.attention ? <AttentionDot /> : null}
				</button>
				{client && !readOnly ? (
					<>
						<IconButton
							size="l"
							className="size-touch shrink-0"
							icon={RiAddLine}
							label={t("mobile.tree.newWorktree")}
							onClick={onNewWorktree}
						/>
						<ProjectActions
							project={project}
							client={client}
							onNewWorktree={onNewWorktree}
							onFailure={onFailure}
						/>
					</>
				) : null}
			</div>
			{expanded ? (
				<ProjectWorkspaces
					host={host}
					project={project}
					controller={controller}
					items={items}
					onFailure={onFailure}
					onOpen={onOpen}
				/>
			) : null}
		</li>
	);
}

/** A project's live workspaces, Default first — the settled shelf stays on the computer. */
function ProjectWorkspaces({
	host,
	project,
	controller,
	items,
	onFailure,
	onOpen,
}: {
	host: SavedHost;
	project: Project;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	onFailure: ReportFailure;
	onOpen: (workspace: Workspace) => void;
}) {
	const t = useT();
	const client = useHostClient(controller, host.hostKey);
	const readOnly = useHostAccess(controller, host.hostKey) === "read";
	const loaded = useHostRequest<Workspace[]>(
		client,
		"workspace.list",
		{
			projectId: project.id,
			includeDiffStats: false,
		},
		"",
		WORKSPACE_PUSHES,
	);
	const welcome = useHostWelcome(controller, host.hostKey);
	const now = useNow();
	const settleIdleDays = welcome?.config.settleIdleDays ?? DEFAULT_CONFIG.settleIdleDays;
	const statusOf = (workspace: Workspace) =>
		scopeStatus(items, (item) => item.record.workspaceId === workspace.id);
	const live =
		loaded.kind === "ready"
			? {
					...loaded,
					value: partitionWorkspaces(loaded.value, {
						now,
						settleIdleDays,
						busy: (workspace) => {
							const status = statusOf(workspace);
							return status.running || status.attention;
						},
					}).live,
				}
			: loaded;
	return (
		<LoadedList
			loaded={live}
			empty={<TreeNote depth="workspace" text={t("mobile.project.empty")} />}
			loading={<TreeNote depth="workspace" pending text={t("mobile.list.loading")} />}
		>
			{(workspaces) =>
				workspaces.map((workspace) => {
					const status = statusOf(workspace);
					const twoLine = workspace.branch !== workspace.name;
					return (
						<li key={workspace.id} className="flex items-center pr-4">
							<button
								type="button"
								onClick={() => onOpen(workspace)}
								className={`flex min-h-touch min-w-0 flex-1 gap-12 border-0 bg-transparent py-8 pl-64 text-left active:bg-control-bg-hovered ${twoLine ? "items-start" : "items-center"}`}
							>
								<WorkspaceGlyph
									kind={workspace.kind}
									active={false}
									running={status.running}
									twoLine={twoLine}
									className="size-20"
								/>
								<span className="flex min-w-0 flex-1 flex-col gap-2">
									<span className="truncate text-text-default tr-text-ui">
										{workspaceName(t, workspace)}
									</span>
									{twoLine ? <WorkspaceBranch branch={workspace.branch} /> : null}
								</span>
								{status.attention ? <AttentionDot /> : null}
							</button>
							{client && !readOnly ? (
								<WorkspaceActions
									workspace={workspace}
									client={client}
									status={status}
									onFailure={onFailure}
								/>
							) : null}
						</li>
					);
				})
			}
		</LoadedList>
	);
}
