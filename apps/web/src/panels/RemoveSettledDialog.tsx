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
import { removeSettledWorkspaces } from "./workspaceActions";

type Preview =
	| { kind: "checking" }
	| { kind: "failed" }
	| { kind: "ready"; rows: SettledRemovalPreview[] };

export type RemovalFlag = "dirty" | "unpushed" | "unchecked";

/** Only a complete, successful preview can clear a row; absent or `null` counts are unsafe, not clean. */
export function flagSettledRemovals(
	workspaces: readonly Pick<Workspace, "id">[],
	preview: Preview,
): Map<string, RemovalFlag> {
	const flags = new Map<string, RemovalFlag>();
	const rows = new Map(
		preview.kind === "ready" ? preview.rows.map((row) => [row.id, row] as const) : [],
	);
	for (const workspace of workspaces) {
		const row = rows.get(workspace.id);
		if (!row || row.dirty === null || row.unpushed === null) flags.set(workspace.id, "unchecked");
		else if (row.dirty > 0) flags.set(workspace.id, "dirty");
		else if (row.unpushed > 0) flags.set(workspace.id, "unpushed");
	}
	return flags;
}

function flagSummary(flags: ReadonlyMap<string, RemovalFlag>): string {
	const count = (flag: RemovalFlag) => [...flags.values()].filter((f) => f === flag).length;
	return [
		count("dirty") > 0 ? `${count("dirty")} with uncommitted changes` : null,
		count("unpushed") > 0 ? `${count("unpushed")} with unpushed commits` : null,
		count("unchecked") > 0 ? `${count("unchecked")} that couldn't be checked` : null,
	]
		.filter(Boolean)
		.join(", ");
}

export function RemoveSettledDialog({
	workspaces,
	open,
	onOpenChange,
}: {
	workspaces: Workspace[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [preview, setPreview] = useState<Preview>({ kind: "checking" });
	const [includeFlagged, setIncludeFlagged] = useState(false);
	const idsKey = workspaces.map((w) => w.id).join("\n");

	useEffect(() => {
		if (!open) return;
		setPreview({ kind: "checking" });
		setIncludeFlagged(false);
		let cancelled = false;
		void getTransport()
			.request("workspace.settledRemovalPreview", { ids: idsKey ? idsKey.split("\n") : [] })
			.then((rows) => {
				if (!cancelled) setPreview({ kind: "ready", rows });
			})
			.catch(() => {
				if (!cancelled) setPreview({ kind: "failed" });
			});
		return () => {
			cancelled = true;
		};
	}, [open, idsKey]);

	const checking = preview.kind === "checking";
	const flags = checking
		? new Map<string, RemovalFlag>()
		: flagSettledRemovals(workspaces, preview);
	const targets = checking ? [] : workspaces.filter((w) => includeFlagged || !flags.has(w.id));

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
				{checking ? (
					<p className="text-text-muted tr-text-metadata" data-testid="remove-settled-checking">
						Checking for uncommitted or unpushed work…
					</p>
				) : flags.size > 0 ? (
					<div className="flex flex-col gap-8">
						<p
							className="rounded-[var(--radius-sm)] bg-feedback-warning-subtle px-12 py-8 text-text-default tr-text-metadata"
							data-testid="remove-settled-flagged"
							data-preview={preview.kind}
						>
							<span className="tr-text-emphasis">{flagSummary(flags)}</span> — left out unless you
							include them.
						</p>
						<div className="flex items-center justify-between gap-12 tr-text-ui text-text-default">
							<span>Include them ({flags.size})</span>
							<SettingsSwitch
								checked={includeFlagged}
								label={`Include ${flags.size} flagged workspaces`}
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
						disabled={targets.length === 0}
						onClick={() => {
							removeSettledWorkspaces(targets);
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
