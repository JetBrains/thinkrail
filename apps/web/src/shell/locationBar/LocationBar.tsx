import type { OpenBranchReview, Project, Workspace } from "@thinkrail/contracts";
import { BranchSegment, ReviewSegment } from "./BranchSegment";
import { ProjectSegment } from "./ProjectSegment";
import { WorkspaceSegment } from "./WorkspaceSegment";

export function LocationBar({
	project,
	workspace,
	review,
	onNewWorkspace,
}: {
	project: Project;
	workspace: Workspace | null;
	review: OpenBranchReview | null;
	onNewWorkspace: () => void;
}) {
	const shownReview = review ?? workspace?.review ?? null;
	return (
		<div
			data-testid="scope-context"
			data-context={workspace ? "workspace" : "project-home"}
			className="flex h-topbar-row min-w-0 flex-1 items-stretch overflow-hidden"
		>
			<ProjectSegment project={project} atHome={workspace === null} />
			<WorkspaceSegment project={project} workspace={workspace} onNewWorkspace={onNewWorkspace} />
			{workspace ? <BranchSegment workspace={workspace} review={shownReview} /> : null}
			{workspace && shownReview ? <ReviewSegment review={shownReview} /> : null}
		</div>
	);
}
