import type { OpenBranchReview, Project, Workspace } from "@thinkrail/contracts";
import { useNow } from "../../components/useNow";
import type { BranchFacts } from "../../panels/branchStatusState";
import { resolveBranchReview } from "../../panels/useBranchStatus";
import { isChatWorkspace, selectWorkspaceContainerId, useAppStore } from "../../store";
import { BranchSegment } from "./BranchSegment";
import { ChatSegment } from "./ChatSegment";
import { ContainerSegment } from "./ContainerSegment";
import { ProjectSegment } from "./ProjectSegment";
import { ShipStrip } from "./ShipSegments";
import { useActiveWorkspaceSettled, WorkspaceSegment } from "./WorkspaceSegment";

export function LocationBar({
	project,
	workspace,
	review,
	branchStatus,
	noteOpenReview,
	refreshBranchStatus,
	newWorkspaceShortcut,
	onNewWorkspace,
}: {
	project: Project;
	workspace: Workspace | null;
	review: OpenBranchReview | null;
	branchStatus: BranchFacts | null;
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
	refreshBranchStatus: () => void;
	newWorkspaceShortcut: string;
	onNewWorkspace: () => void;
}) {
	const workspaceSettlingSupported = useAppStore((state) => state.workspaceSettlingSupported);
	const now = useNow();
	const settled = useActiveWorkspaceSettled(workspace, now);
	const resolvedReview = resolveBranchReview(review, workspace?.review, workspaceSettlingSupported);
	const shownReview = resolvedReview.review;
	const containerId = useAppStore((s) =>
		workspace ? selectWorkspaceContainerId(s, workspace) : null,
	);
	const scope =
		workspace && containerId ? (
			<ContainerSegment containerId={containerId} activeWorkspaceId={workspace.id} />
		) : (
			<ProjectSegment project={project} atHome={workspace === null} />
		);
	if (workspace && isChatWorkspace(workspace)) {
		return (
			<div
				data-testid="scope-context"
				data-context="chat"
				className="flex min-w-0 flex-1 items-stretch self-stretch overflow-hidden"
			>
				{scope}
				<ChatSegment workspace={workspace} />
			</div>
		);
	}
	return (
		<div
			data-testid="scope-context"
			data-context={workspace ? "workspace" : "project-home"}
			className="flex min-w-0 flex-1 items-stretch self-stretch overflow-hidden"
		>
			{scope}
			<WorkspaceSegment
				project={project}
				workspace={workspace}
				activeSettled={settled}
				now={now}
				newWorkspaceShortcut={newWorkspaceShortcut}
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
			{workspace ? (
				<ShipStrip
					key={workspace.id}
					workspace={workspace}
					status={branchStatus}
					review={shownReview}
					settled={settled}
					noteOpenReview={noteOpenReview}
					refresh={refreshBranchStatus}
				/>
			) : null}
		</div>
	);
}
