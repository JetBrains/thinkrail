import type { OpenBranchReview, Project, Workspace } from "@thinkrail/contracts";
import { resolveBranchReview } from "../../panels/useOpenBranchReview";
import { supportsWorkspaceSettling, useAppStore } from "../../store";
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
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const resolvedReview = resolveBranchReview(
		review,
		workspace?.review,
		supportsWorkspaceSettling(protocolVersion),
	);
	const shownReview = resolvedReview.review;
	return (
		<div
			data-testid="scope-context"
			data-context={workspace ? "workspace" : "project-home"}
			className="flex h-topbar-row min-w-0 flex-1 items-stretch overflow-hidden"
		>
			<ProjectSegment project={project} atHome={workspace === null} />
			<WorkspaceSegment project={project} workspace={workspace} onNewWorkspace={onNewWorkspace} />
			{workspace ? (
				<BranchSegment
					workspace={workspace}
					review={shownReview}
					reviewDetailsKnown={resolvedReview.detailsKnown}
				/>
			) : null}
			{workspace && shownReview ? <ReviewSegment review={shownReview} /> : null}
		</div>
	);
}
