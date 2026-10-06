import type { Workspace } from "@thinkrail/contracts";
import { isExternalWorkspace } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";
import { removeWorkspace } from "./workspaceActions";

export function RemoveWorkspaceDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: Workspace;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const isExternal = isExternalWorkspace(workspace);
	const branch = <span className="tr-text-emphasis text-text-default">{workspace.branch}</span>;
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title={
				isExternal
					? `Remove ${workspace.name} from ThinkRail?`
					: `Remove ${workspace.name} workspace`
			}
			description={
				isExternal ? (
					<>
						Removes this workspace's ThinkRail chats and terminals. The existing checkout, files,
						and branch {branch} stay untouched.
					</>
				) : (
					<>
						Deletes this workspace's chats, terminals, and its worktree. The git branch {branch} is
						kept.
					</>
				)
			}
			confirmLabel={isExternal ? "Remove from ThinkRail" : "Remove"}
			destructive
			confirmTestId="confirm-remove"
			onConfirm={() => removeWorkspace(workspace.id)}
		/>
	);
}
