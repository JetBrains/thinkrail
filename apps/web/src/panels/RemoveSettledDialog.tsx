import type { SettledRemovalPreview, Workspace } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useEffect, useState } from "react";
import { getTransport } from "../transport";
import { SettingsSwitch } from "./SettingsSwitch";
import { removeWorkspace } from "./workspaceActions";

export function RemoveSettledDialog({
	workspaces,
	open,
	onOpenChange,
}: {
	workspaces: Workspace[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [preview, setPreview] = useState<SettledRemovalPreview[] | null>(null);
	const [includeFlagged, setIncludeFlagged] = useState(false);

	useEffect(() => {
		if (!open) return;
		setPreview(null);
		setIncludeFlagged(false);
		let cancelled = false;
		void getTransport()
			.request("workspace.settledRemovalPreview", { ids: workspaces.map((w) => w.id) })
			.then((rows) => {
				if (!cancelled) setPreview(rows);
			})
			.catch(() => {
				if (!cancelled) setPreview([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, workspaces]);

	const flagged = new Set(
		(preview ?? [])
			.filter((row) => (row.dirty ?? 0) > 0 || (row.unpushed ?? 0) > 0)
			.map((row) => row.id),
	);
	const dirtyCount = (preview ?? []).filter((row) => (row.dirty ?? 0) > 0).length;
	const unpushedCount = (preview ?? []).filter(
		(row) => (row.dirty ?? 0) === 0 && (row.unpushed ?? 0) > 0,
	).length;
	const targets = workspaces.filter((w) => includeFlagged || !flagged.has(w.id));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				role="alertdialog"
				className="max-w-[26rem]"
				hideClose
				data-testid="remove-settled-dialog"
			>
				<DialogHeader>
					<DialogTitle>
						Remove {workspaces.length} settled workspace{workspaces.length === 1 ? "" : "s"}?
					</DialogTitle>
					<DialogDescription>
						Deletes their chats, terminals, and worktrees. Git branches are kept.
					</DialogDescription>
				</DialogHeader>
				{preview === null ? (
					<p className="text-text-muted tr-text-metadata" data-testid="remove-settled-checking">
						Checking for uncommitted or unpushed work…
					</p>
				) : flagged.size > 0 ? (
					<div className="flex flex-col gap-8">
						<p
							className="rounded-[var(--radius-sm)] bg-feedback-warning-subtle px-12 py-8 text-text-default tr-text-metadata"
							data-testid="remove-settled-flagged"
						>
							<span className="tr-text-emphasis">
								{dirtyCount > 0 ? `${dirtyCount} with uncommitted changes` : null}
								{dirtyCount > 0 && unpushedCount > 0 ? ", " : null}
								{unpushedCount > 0 ? `${unpushedCount} with unpushed commits` : null}
							</span>{" "}
							— left out unless you include them.
						</p>
						<div className="flex items-center justify-between gap-12 tr-text-ui text-text-default">
							<span>Include them ({flagged.size})</span>
							<SettingsSwitch
								checked={includeFlagged}
								label={`Include ${flagged.size} flagged workspaces`}
								testId="remove-settled-include"
								onChange={setIncludeFlagged}
							/>
						</div>
					</div>
				) : null}
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						data-testid="confirm-remove-settled"
						disabled={preview === null || targets.length === 0}
						onClick={() => {
							for (const workspace of targets) removeWorkspace(workspace.id);
							onOpenChange(false);
						}}
					>
						Remove {targets.length}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
