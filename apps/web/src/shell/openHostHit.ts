import type { SearchHit, Workspace } from "@thinkrail/contracts";

type WorkspaceTarget = Pick<Workspace, "id" | "projectId">;

export interface ChatLocation {
	readonly workspaceId: string;
	readonly projectId: string;
	readonly sessionId: string;
	readonly messageIndex: number;
	readonly anchorText: string;
}

export interface HostHitTargets {
	readonly navigateToWorkspace: (
		workspace: WorkspaceTarget,
		sessionId?: string,
	) => Promise<boolean>;
	readonly loadWorkspaceRow: (workspace: WorkspaceTarget) => Promise<boolean>;
	readonly openFile: (workspaceId: string, path: string) => Promise<void>;
	readonly openSpec: (workspaceId: string, path: string) => void;
	readonly openChatLocation: (location: ChatLocation) => void;
	readonly openPlan: (workspaceId: string) => void;
}

export async function openHostHit(hit: SearchHit, targets: HostHitTargets): Promise<void> {
	if (!hit.workspaceId) return;
	const workspace = { id: hit.workspaceId, projectId: hit.projectId };
	switch (hit.kind) {
		case "file":
			if ((await targets.navigateToWorkspace(workspace)) && hit.path) {
				await targets.openFile(workspace.id, hit.path);
			}
			return;
		case "spec":
			if ((await targets.navigateToWorkspace(workspace)) && hit.path) {
				targets.openSpec(workspace.id, hit.path);
			}
			return;
		case "transcript":
			if (hit.sessionId && hit.messageIndex !== undefined && hit.anchorText !== undefined) {
				if (!(await targets.loadWorkspaceRow(workspace))) return;
				targets.openChatLocation({
					workspaceId: workspace.id,
					projectId: workspace.projectId,
					sessionId: hit.sessionId,
					messageIndex: hit.messageIndex,
					anchorText: hit.anchorText,
				});
			} else await targets.navigateToWorkspace(workspace, hit.sessionId);
			return;
		case "plan":
			if (await targets.navigateToWorkspace(workspace, hit.sessionId)) {
				targets.openPlan(workspace.id);
			}
			return;
		case "chat":
		case "workspace":
			await targets.navigateToWorkspace(workspace, hit.sessionId);
			return;
	}
}
