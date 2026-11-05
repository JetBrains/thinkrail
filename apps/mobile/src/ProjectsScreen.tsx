import {
	RiAddLine,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiCloseLine,
	RiSettings3Line,
} from "@remixicon/react";
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
import { useState } from "react";
import type { PairState } from "./App";
import { HostBanner } from "./HostBanner";
import type { HostFailure } from "./hostStatus";
import { LoadedList, Loader, Notice, Screen } from "./layout";
import { scopeStatus } from "./status";
import { ProjectActions, type ReportFailure, WorkspaceActions } from "./TreeActions";
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

export function ProjectsScreen({
	hosts,
	controller,
	items,
	unreachable,
	pair,
	onPair,
	expanded,
	onToggle,
	onSettings,
	onReconnect,
	onForget,
	onDismiss,
	onNewWorktree,
	onOpen,
}: {
	/** The computers to show — a computer whose banner was closed is left out until it fails again. */
	hosts: SavedHost[];
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	/** Hosts that failed to connect, keyed by host key, with why. */
	unreachable: ReadonlyMap<string, HostFailure>;
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	/** Expanded projects, keyed `hostKey:projectId`, kept by the app so returning from a chat keeps the tree. */
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onSettings: () => void;
	onReconnect: (host: SavedHost) => void;
	onForget: (host: SavedHost) => void;
	onDismiss: (host: SavedHost) => void;
	onNewWorktree: (hostKey: string, project: Project) => void;
	onOpen: (hostKey: string, project: Project, workspace: Workspace) => void;
}) {
	const t = useT();
	const [failure, setFailure] = useState<string | null>(null);
	return (
		<Screen
			title={t("mobile.projects.title")}
			action={
				<IconButton
					size="l"
					className="size-touch shrink-0"
					icon={RiSettings3Line}
					label={t("shell.topbar.settings")}
					onClick={onSettings}
				/>
			}
		>
			{failure ? (
				<div
					role="alert"
					className="flex items-center gap-8 border-b border-feedback-error-muted bg-feedback-error-subtle py-4 pr-4 pl-16"
				>
					<p className="m-0 min-w-0 flex-1 text-feedback-error tr-text-metadata">{failure}</p>
					<IconButton
						size="l"
						className="size-touch shrink-0"
						icon={RiCloseLine}
						label={t("common.dismiss")}
						onClick={() => setFailure(null)}
					/>
				</div>
			) : null}
			{hosts.length === 0 ? <Notice text={t("mobile.projects.allHidden")} /> : null}
			{hosts.flatMap((host) => {
				const failure = unreachable.get(host.hostKey);
				return failure === undefined
					? []
					: [
							<HostBanner
								key={host.hostKey}
								host={host}
								failure={failure}
								pair={pair}
								onPair={onPair}
								onReconnect={() => onReconnect(host)}
								onForget={() => onForget(host)}
								onDismiss={() => onDismiss(host)}
							/>,
						];
			})}
			{hosts
				.filter((host) => !unreachable.has(host.hostKey))
				.map((host) => (
					<HostProjects
						key={host.hostKey}
						host={host}
						heading={hosts.length > 1}
						controller={controller}
						items={items.filter((item) => item.hostKey === host.hostKey)}
						expanded={expanded}
						onToggle={onToggle}
						onFailure={setFailure}
						onOpen={(project, workspace) => onOpen(host.hostKey, project, workspace)}
						onNewWorktree={(project) => onNewWorktree(host.hostKey, project)}
					/>
				))}
		</Screen>
	);
}

function HostProjects({
	host,
	heading,
	controller,
	items,
	expanded,
	onToggle,
	onFailure,
	onOpen,
	onNewWorktree,
}: {
	host: SavedHost;
	heading: boolean;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onFailure: ReportFailure;
	onOpen: (project: Project, workspace: Workspace) => void;
	onNewWorktree: (project: Project) => void;
}) {
	const t = useT();
	const client = controller.clientFor(host.hostKey);
	const loaded = useHostRequest<Project[]>(client, "project.list", {}, "", PROJECT_PUSHES);
	const open =
		loaded.kind === "ready" ? { ...loaded, value: loaded.value.filter((p) => !p.closed) } : loaded;

	return (
		<section className="py-4">
			{heading ? (
				<h2 className="m-0 px-16 pt-12 pb-4 text-text-subtle tr-text-eyebrow">{host.label}</h2>
			) : null}
			<LoadedList
				loaded={open}
				empty={t("mobile.projects.empty")}
				loading={
					client ? undefined : (
						<Loader text={t("mobile.projects.connecting", { host: host.label })} />
					)
				}
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
		</section>
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
	return (
		<li>
			<div className="flex items-center pr-4">
				<button
					type="button"
					aria-expanded={expanded}
					onClick={onToggle}
					className="flex min-h-touch min-w-0 flex-1 items-center gap-8 border-0 bg-transparent py-8 pl-12 text-left active:bg-control-bg-hovered"
				>
					<Chevron aria-hidden className="size-20 shrink-0 text-text-muted" />
					<ProjectGlyph selected={false} running={status.running} className="size-22" />
					<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">
						{project.name}
					</span>
					{status.attention ? <AttentionDot /> : null}
				</button>
				{client ? (
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
	const client = controller.clientFor(host.hostKey);
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
	const settleIdleDays =
		controller.welcomeFor(host.hostKey)?.config.settleIdleDays ?? DEFAULT_CONFIG.settleIdleDays;
	const statusOf = (workspace: Workspace) =>
		scopeStatus(items, (item) => item.record.workspaceId === workspace.id);
	const live =
		loaded.kind === "ready"
			? {
					...loaded,
					value: partitionWorkspaces(loaded.value, {
						now: Date.now(),
						settleIdleDays,
						busy: (workspace) => {
							const status = statusOf(workspace);
							return status.running || status.attention;
						},
					}).live,
				}
			: loaded;
	const pending = (text: string) => (
		<div
			role="status"
			className="flex min-h-touch items-center gap-12 pr-12 pl-40 text-text-muted tr-text-reading"
		>
			<RunningIcon className="size-20 text-primary" />
			{text}
		</div>
	);

	return (
		<LoadedList
			loaded={live}
			empty={t("mobile.project.empty")}
			loading={pending(t("mobile.list.loading"))}
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
								className={`flex min-h-touch min-w-0 flex-1 gap-12 border-0 bg-transparent py-8 pl-40 text-left active:bg-control-bg-hovered ${twoLine ? "items-start" : "items-center"}`}
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
							{client ? (
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
