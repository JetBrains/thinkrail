import type { Container, Workspace } from "@thinkrail/contracts";
import { type Translator, t } from "@thinkrail/locales/react";
import {
	selectActiveWorkspace,
	selectContainerGroup,
	selectLastContainerMember,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport, supportsContainers, wsErrorCode } from "../transport";
import { loadProjectWorkspaces } from "./workspaceActions";

export function canUseContainers(protocolVersion: number | null): boolean {
	return supportsContainers(protocolVersion);
}

/** A member's second line: its branch when it differs from the name, prefixed by its project when the container spans several. */
export function memberSubtitle(
	translate: Translator,
	workspace: Pick<Workspace, "name" | "branch">,
	projectName?: string,
): string | null {
	if (!projectName) return workspace.branch === workspace.name ? null : workspace.branch;
	return workspace.branch === workspace.name
		? projectName
		: translate("containers.memberSubtitle", { project: projectName, branch: workspace.branch });
}

function reportContainerFailure(containerId: string | null, err: unknown, fallback: string): void {
	if (containerId && wsErrorCode(err) === "CONTAINER_UNKNOWN") {
		useAppStore.getState().applyContainerRemoved(containerId);
	}
	toast.error(errorText(err, fallback));
}

export function renameContainer(container: Container, name: string): void {
	void getTransport()
		.request("container.rename", { containerId: container.id, name })
		.catch((err) => reportContainerFailure(container.id, err, t("containers.renameFailed")));
}

export async function groupIntoContainer(workspaceIds: string[], name?: string): Promise<boolean> {
	try {
		const container = await getTransport().request("container.create", {
			workspaceIds,
			...(name ? { name } : {}),
		});
		useAppStore.getState().applyContainerUpdated(container);
		return true;
	} catch (err) {
		reportContainerFailure(null, err, t("containers.createFailed"));
		return false;
	}
}

export async function attachToContainer(
	containerId: string,
	workspaceId: string,
): Promise<boolean> {
	try {
		const container = await getTransport().request("container.addWorkspace", {
			containerId,
			workspaceId,
		});
		useAppStore.getState().applyContainerUpdated(container);
		return true;
	} catch (err) {
		reportContainerFailure(containerId, err, t("containers.addFailed"));
		return false;
	}
}

/** A new workspace through the background creation flow; the host joins it to the container as it hands it over. */
export async function startWorkspaceInContainer(params: {
	containerId: string;
	projectId: string;
	baseRef: string;
	text: string;
}): Promise<boolean> {
	const { containerId, projectId, baseRef, text } = params;
	try {
		const creation = await getTransport().request("workspace.startCreate", {
			projectId,
			...(baseRef ? { baseRef } : {}),
			kickoff: { text },
			into: containerId,
		});
		const store = useAppStore.getState();
		store.applyWorkspaceCreation(creation, { text, attachments: [] });
		store.expandProject(creation.projectId);
		void loadProjectWorkspaces(creation.projectId).catch(() => {});
		store.selectCreation(creation.id);
		return true;
	} catch (err) {
		reportContainerFailure(containerId, err, t("containers.addFailed"));
		return false;
	}
}

export function leaveContainer(containerId: string, workspaceId: string): void {
	void getTransport()
		.request("container.removeWorkspace", { containerId, workspaceId })
		.then((container) => {
			const store = useAppStore.getState();
			if (container) store.applyContainerUpdated(container);
			else store.applyContainerRemoved(containerId);
		})
		.catch((err) => reportContainerFailure(containerId, err, t("containers.leaveFailed")));
}

/** Archives the chosen members through `workspace.remove`, then dissolves the container; a failed archive keeps it. */
export async function removeContainer(containerId: string, archiveIds: string[]): Promise<boolean> {
	const transport = getTransport();
	const archived = await Promise.allSettled(
		archiveIds.map((id) => transport.request("workspace.remove", { id })),
	);
	const failed = archived.find(
		(result): result is PromiseRejectedResult => result.status === "rejected",
	);
	if (failed) {
		toast.error(errorText(failed.reason, t("containers.archiveFailed")));
		return false;
	}
	try {
		await transport.request("container.remove", { containerId });
		useAppStore.getState().applyContainerRemoved(containerId);
		return true;
	} catch (err) {
		reportContainerFailure(containerId, err, t("containers.removeFailed"));
		return false;
	}
}

/**
 * Shows the container's orchestrator pinned beside a member: in the active member, else in the member the
 * user was in last. Without a shown member it opens the orchestrator chat as the workspace instead.
 */
export function openOrchestrator(containerId: string): void {
	const state = useAppStore.getState();
	const group = selectContainerGroup(state, containerId);
	if (!group?.orchestrator) return;
	const active = selectActiveWorkspace(state);
	if (active?.id === group.orchestrator.id) return;
	const member = group.members.some((candidate) => candidate.id === active?.id)
		? active
		: selectLastContainerMember(state, group);
	if (!member) {
		state.activateWorkspace(group.orchestrator);
		return;
	}
	state.activateWorkspace(member);
	useAppStore.getState().requestToolView(member.id, "orchestrator");
}

/** Opens the container's overview in Peek: the active workspace's, else the last member's it enters. */
export function openContainerOverview(containerId: string): void {
	const state = useAppStore.getState();
	const group = selectContainerGroup(state, containerId);
	if (!group) return;
	const target = selectActiveWorkspace(state) ?? selectLastContainerMember(state, group);
	if (!target) return;
	if (state.activeWorkspaceId !== target.id) state.activateWorkspace(target);
	useAppStore.getState().requestPeek(target.id, { kind: "container", containerId });
}

/** Enters a member from the overview Peek in `fromWorkspaceId`, which then shows there too. */
export function openContainerMember(fromWorkspaceId: string, member: Workspace): void {
	const state = useAppStore.getState();
	state.carryPeek(fromWorkspaceId, member.id);
	state.activateWorkspace(member);
}
