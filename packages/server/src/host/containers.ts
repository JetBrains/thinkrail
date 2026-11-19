import { forgetContainerMember, syncContainerMemberLinks } from "../containers";
import { logger } from "../log";
import type { WorkspaceLifecycleEvent } from "../workspaces";

const log = logger("host");

/** The workspace lifecycle seen by containers: a removed workspace leaves its container, an updated one relinks. */
export function observeWorkspaceForContainers(event: WorkspaceLifecycleEvent): void {
	if (event.kind === "removed") {
		void forgetContainerMember(event.id).catch((error) =>
			log.warn(`workspace ${event.id} could not leave its container`, error),
		);
	} else if (event.kind === "updated") {
		syncContainerMemberLinks(event.workspace.id);
	}
}
