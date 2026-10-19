import type { OpenBranchReview, Project, Workspace } from "@thinkrail/contracts";
import { useNow } from "../../components/useNow";
import type { BranchFacts } from "../../panels/branchStatusState";
import { resolveBranchReview } from "../../panels/useBranchStatus";
import { useShipRunner } from "../../panels/useShipRunner";
import { selectWorkspaceChatTab, useAppStore } from "../../store";
import { BranchSegment, ReviewSegment } from "./BranchSegment";
import { ProjectSegment } from "./ProjectSegment";
import { ShipSegments } from "./ShipSegments";
import { useActiveWorkspaceSettled, WorkspaceSegment } from "./WorkspaceSegment";

export function LocationBar({
	project,
	workspace,
	review,
	branchStatus,
	noteOpenReview,
	refreshBranchStatus,
	onNewWorkspace,
}: {
	project: Project;
	workspace: Workspace | null;
	review: OpenBranchReview | null;
	branchStatus: BranchFacts | null;
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
	refreshBranchStatus: () => void;
	onNewWorkspace: () => void;
}) {
	const workspaceSettlingSupported = useAppStore((state) => state.workspaceSettlingSupported);
	const sessionId = useAppStore((state) =>
		workspace ? (selectWorkspaceChatTab(state, workspace.id)?.sessionId ?? null) : null,
	);
	const now = useNow();
	const settled = useActiveWorkspaceSettled(workspace, now);
	const resolvedReview = resolveBranchReview(review, workspace?.review, workspaceSettlingSupported);
	const shownReview = resolvedReview.review;
	const runner = useShipRunner({
		workspace,
		sessionId,
		openReview: null,
		status: branchStatus,
		noteOpenReview,
		refresh: refreshBranchStatus,
	});
	return (
		<div
			data-testid="scope-context"
			data-context={workspace ? "workspace" : "project-home"}
			className="flex min-w-0 flex-1 items-stretch self-stretch overflow-hidden"
		>
			<ProjectSegment project={project} atHome={workspace === null} />
			<WorkspaceSegment
				project={project}
				workspace={workspace}
				activeSettled={settled}
				now={now}
				onNewWorkspace={onNewWorkspace}
			/>
			{workspace ? (
				<BranchSegment
					workspace={workspace}
					review={shownReview}
					reviewDetailsKnown={resolvedReview.detailsKnown}
					status={branchStatus}
				/>
			) : null}
			{workspace && branchStatus ? (
				<ShipSegments
					workspace={workspace}
					status={branchStatus}
					review={shownReview}
					settled={settled}
					runner={runner}
				/>
			) : workspace && shownReview ? (
				<ReviewSegment review={shownReview} />
			) : null}
			{runner.dialogs}
		</div>
	);
}
