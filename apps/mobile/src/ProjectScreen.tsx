import { RiFolderOpenLine, RiGitBranchLine, RiHome2Line } from "@remixicon/react";
import { DEFAULT_WORKSPACE_NAME, type Project, type Workspace } from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import type { DeviceWireClient, RemoteSessionItem } from "@thinkrail/remote-client";
import { ListRow, LoadedList, Screen } from "./layout";
import { scopeStatus } from "./status";
import { useHostRequest } from "./useHostRequest";

export function workspaceName(t: Translator, workspace: Workspace): string {
	return workspace.kind === "default" && workspace.name === DEFAULT_WORKSPACE_NAME
		? t("store.workspace.defaultName")
		: workspace.name;
}

const workspaceIcon = (workspace: Workspace) =>
	workspace.kind === "default"
		? RiHome2Line
		: workspace.kind === "external"
			? RiFolderOpenLine
			: RiGitBranchLine;

export function ProjectScreen({
	project,
	client,
	items,
	onBack,
	onOpen,
}: {
	project: Project;
	client: DeviceWireClient | null;
	items: RemoteSessionItem[];
	onBack: () => void;
	onOpen: (workspace: Workspace) => void;
}) {
	const t = useT();
	const loaded = useHostRequest<Workspace[]>(client, "workspace.list", {
		projectId: project.id,
		includeDiffStats: false,
	});

	return (
		<Screen title={project.name} back={{ label: t("mobile.projects.title"), onBack }}>
			<LoadedList loaded={loaded} empty={t("mobile.project.empty")}>
				{(workspaces) =>
					workspaces.map((workspace) => {
						const name = workspaceName(t, workspace);
						return (
							<ListRow
								key={workspace.id}
								icon={workspaceIcon(workspace)}
								title={name}
								detail={workspace.branch !== workspace.name ? workspace.branch : undefined}
								status={scopeStatus(items, (item) => item.record.workspaceId === workspace.id)}
								onOpen={() => onOpen(workspace)}
							/>
						);
					})
				}
			</LoadedList>
		</Screen>
	);
}
