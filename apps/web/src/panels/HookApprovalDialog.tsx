import type { HookName } from "@thinkrail/contracts";
import { toast } from "../store";
import { errorText } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { approveAndRunHook } from "./hooksActions";

/**
 * The approval prompt for a pending hook command — shared by the workspace row's badge (fast path for
 * `awaitingApproval`) and the Hooks panel (reachable from any workspace, any state). A centered modal, not
 * an anchored popover: approving trusts an arbitrary shell command for every workspace in this project
 * going forward, not just a one-off action on this row.
 */
export function HookApprovalDialog({
	open,
	onOpenChange,
	projectId,
	workspaceId,
	hook,
	command,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	workspaceId: string;
	hook: HookName;
	command: string;
}) {
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`Approve ${hook} for this project?`}
			description={
				<>
					<p className="pb-xs">
						This command will run automatically for every workspace in this project from now on:
					</p>
					<code className="block overflow-auto rounded-[var(--radius-sm)] bg-elevated px-sm py-xs font-[var(--font-mono)] text-xs">
						{command}
					</code>
				</>
			}
			confirmLabel="Approve & Run"
			confirmTestId="confirm-approve-hook"
			onConfirm={() => {
				void approveAndRunHook(projectId, workspaceId, hook, command).catch((err) =>
					toast.error(errorText(err, "Failed to approve hook")),
				);
			}}
		/>
	);
}
