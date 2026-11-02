import { RiAddLine, RiArrowDownSLine, RiArrowRightSLine, RiSettings3Line } from "@remixicon/react";
import {
	DEFAULT_CONFIG,
	DEFAULT_WORKSPACE_NAME,
	type Project,
	partitionWorkspaces,
	type Workspace,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import type {
	RemoteSessionItem,
	RemoteSessionsController,
	SavedHost,
} from "@thinkrail/remote-client";
import { AttentionDot } from "@thinkrail/ui/attention-dot";
import { IconButton } from "@thinkrail/ui/button";
import { ProjectGlyph, WorkspaceGlyph, WorkspaceLabel } from "@thinkrail/ui/project-tree";
import { RunningIcon } from "@thinkrail/ui/running-icon";
import type { ReactNode } from "react";
import { LoadedList, Loader, Screen } from "./layout";
import { scopeStatus } from "./status";
import { useHostRequest } from "./useHostRequest";

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
	expanded,
	onToggle,
	adding,
	onAdd,
	onSettings,
	pairForm,
	onOpen,
}: {
	hosts: SavedHost[];
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	unreachable: [host: string, reason: string][];
	/** Expanded projects, keyed `hostKey:projectId`, kept by the app so returning from a chat keeps the tree. */
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	adding: boolean;
	onAdd: () => void;
	onSettings: () => void;
	pairForm: ReactNode;
	onOpen: (hostKey: string, project: Project, workspace: Workspace) => void;
}) {
	const t = useT();
	return (
		<Screen
			title={t("mobile.projects.title")}
			action={
				<div className="flex shrink-0 items-center">
					{adding ? null : (
						<IconButton
							size="l"
							className="size-touch"
							icon={RiAddLine}
							label={t("mobile.projects.addHost")}
							onClick={onAdd}
						/>
					)}
					<IconButton
						size="l"
						className="size-touch"
						icon={RiSettings3Line}
						label={t("shell.topbar.settings")}
						onClick={onSettings}
					/>
				</div>
			}
		>
			{unreachable.map(([host, reason]) => (
				<p
					key={host}
					role="status"
					className="m-0 border-b border-feedback-warning-muted bg-feedback-warning-subtle px-16 py-12 text-feedback-warning tr-text-metadata"
				>
					{t("mobile.projects.unreachable", { host, reason })}
				</p>
			))}
			{adding ? (
				<section className="border-b border-border-default bg-container-elevated-bg px-16 py-16">
					<p className="mt-0 mb-12 text-text-muted tr-text-ui">{t("mobile.projects.addHint")}</p>
					{pairForm}
				</section>
			) : null}
			{hosts
				.filter((host) => !unreachable.some(([label]) => label === host.label))
				.map((host) => (
					<HostProjects
						key={host.hostKey}
						host={host}
						heading={hosts.length > 1}
						controller={controller}
						items={items.filter((item) => item.hostKey === host.hostKey)}
						expanded={expanded}
						onToggle={onToggle}
						onOpen={(project, workspace) => onOpen(host.hostKey, project, workspace)}
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
	onOpen,
}: {
	host: SavedHost;
	heading: boolean;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onOpen: (project: Project, workspace: Workspace) => void;
}) {
	const t = useT();
	const client = controller.clientFor(host.hostKey);
	const loaded = useHostRequest<Project[]>(client, "project.list", {});
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
						const status = scopeStatus(items, (item) => item.record.projectId === project.id);
						const isExpanded = expanded.has(key);
						const Chevron = isExpanded ? RiArrowDownSLine : RiArrowRightSLine;
						return (
							<li key={project.id}>
								<button
									type="button"
									aria-expanded={isExpanded}
									onClick={() => onToggle(key)}
									className="flex min-h-touch w-full items-center gap-4 border-0 bg-transparent px-12 text-left active:bg-control-bg-hovered"
								>
									<Chevron aria-hidden className="size-16 shrink-0 text-text-muted" />
									<ProjectGlyph selected={false} running={status.running} />
									<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">
										{project.name}
									</span>
									{status.attention ? <AttentionDot /> : null}
								</button>
								{isExpanded ? (
									<ProjectWorkspaces
										host={host}
										project={project}
										controller={controller}
										items={items}
										onOpen={(workspace) => onOpen(project, workspace)}
									/>
								) : null}
							</li>
						);
					})
				}
			</LoadedList>
		</section>
	);
}

/** A project's live workspaces, Default first — the settled shelf stays on the computer. */
function ProjectWorkspaces({
	host,
	project,
	controller,
	items,
	onOpen,
}: {
	host: SavedHost;
	project: Project;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	onOpen: (workspace: Workspace) => void;
}) {
	const t = useT();
	const loaded = useHostRequest<Workspace[]>(controller.clientFor(host.hostKey), "workspace.list", {
		projectId: project.id,
		includeDiffStats: false,
	});
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

	return (
		<LoadedList
			loaded={live}
			empty={t("mobile.project.empty")}
			loading={
				<div
					role="status"
					className="flex min-h-touch items-center gap-8 pr-12 pl-40 text-text-muted tr-text-ui"
				>
					<RunningIcon className="size-14 text-primary" />
					{t("mobile.list.loading")}
				</div>
			}
		>
			{(workspaces) =>
				workspaces.map((workspace) => {
					const status = statusOf(workspace);
					const twoLine = workspace.branch !== workspace.name;
					return (
						<li key={workspace.id}>
							<button
								type="button"
								onClick={() => onOpen(workspace)}
								className={`flex min-h-touch w-full gap-8 border-0 bg-transparent py-4 pr-12 pl-40 text-left active:bg-control-bg-hovered ${twoLine ? "items-start pt-8" : "items-center"}`}
							>
								<WorkspaceGlyph
									kind={workspace.kind}
									active={false}
									running={status.running}
									twoLine={twoLine}
								/>
								<WorkspaceLabel
									name={workspaceName(t, workspace)}
									branch={twoLine ? workspace.branch : undefined}
									active={false}
								/>
								{status.attention ? <AttentionDot /> : null}
							</button>
						</li>
					);
				})
			}
		</LoadedList>
	);
}
