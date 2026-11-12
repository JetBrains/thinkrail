import type { WorkspaceRemovalCheck } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
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
import {
	type SettledRow,
	selectSettledRemovalCandidates,
	useAppStore,
	workspaceName,
} from "../store";
import { getTransport } from "../transport";
import { SettingsSwitch } from "./SettingsSwitch";
import { removeSettledWorkspaces } from "./workspaceActions";

export type RemovalFlag = "checking" | "dirty" | "unpushed" | "unchecked";

type Checks =
	| { kind: "checking" }
	| { kind: "failed" }
	| { kind: "ready"; byId: Map<string, WorkspaceRemovalCheck> };

/** Only a complete answer clears a row; a missing or `null` count is unsafe, never clean. */
export function removalFlag(checks: Checks, id: string): RemovalFlag | null {
	if (checks.kind === "checking") return "checking";
	const check = checks.kind === "ready" ? checks.byId.get(id) : undefined;
	if (!check || check.dirty === null || check.unpushed === null) return "unchecked";
	if (check.dirty > 0) return "dirty";
	if (check.unpushed > 0) return "unpushed";
	return null;
}

export function SettledRemovalDialog() {
	const review = useAppStore((s) => s.settledRemovalReview);
	return review ? <SettledRemovalReview projectId={review.projectId} /> : null;
}

function SettledRemovalReview({ projectId }: { projectId: string | null }) {
	const t = useT();
	const days = useAppStore((s) => s.settledRemovalDays);
	const [rows] = useState<SettledRow[]>(() =>
		selectSettledRemovalCandidates(useAppStore.getState(), Date.now()).filter(
			(row) => projectId === null || row.workspace.projectId === projectId,
		),
	);
	const [checks, setChecks] = useState<Checks>({ kind: "checking" });
	const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

	useEffect(() => {
		let cancelled = false;
		void getTransport()
			.request("workspace.removalCheck", { ids: rows.map((row) => row.workspace.id) })
			.then((list) => {
				if (!cancelled) setChecks({ kind: "ready", byId: new Map(list.map((c) => [c.id, c])) });
			})
			.catch(() => {
				if (!cancelled) setChecks({ kind: "failed" });
			});
		return () => {
			cancelled = true;
		};
	}, [rows]);

	const close = () => useAppStore.getState().setSettledRemovalReview(null);
	const selected = rows.filter(
		(row) => removalFlag(checks, row.workspace.id) === null && !excluded.has(row.workspace.id),
	);
	const toggle = (id: string, include: boolean) =>
		setExcluded((prev) => {
			const next = new Set(prev);
			if (include) next.delete(id);
			else next.add(id);
			return next;
		});
	const flagText: Record<RemovalFlag, string> = {
		checking: t("panels.settledRemoval.checking"),
		dirty: t("panels.settledRemoval.dirty"),
		unpushed: t("panels.settledRemoval.unpushed"),
		unchecked: t("panels.settledRemoval.unchecked"),
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : close())}>
			<DialogContent
				role="alertdialog"
				className="max-w-[28rem]"
				hideClose
				data-testid="settled-removal-dialog"
			>
				<DialogHeader>
					<DialogTitle>{t("panels.settledRemoval.title")}</DialogTitle>
					<DialogDescription>
						{t("panels.settledRemoval.description", { count: days ?? 0 })}
					</DialogDescription>
				</DialogHeader>
				{rows.length === 0 ? (
					<p className="text-text-muted tr-text-metadata" data-testid="settled-removal-empty">
						{t("panels.settledRemoval.empty")}
					</p>
				) : (
					<ul className="flex max-h-[20rem] flex-col gap-4 overflow-y-auto">
						{rows.map(({ workspace }) => {
							const flag = removalFlag(checks, workspace.id);
							const name = workspaceName(t, workspace);
							return (
								<li
									key={workspace.id}
									data-testid="settled-removal-row"
									data-flag={flag ?? "safe"}
									className="flex min-w-0 items-center gap-8 rounded-sm px-8 py-4"
								>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate tr-text-ui text-text-default">{name}</span>
										<span className="truncate text-text-subtle tr-text-metadata">
											{workspace.branch}
										</span>
									</span>
									{flag === null ? (
										<SettingsSwitch
											checked={!excluded.has(workspace.id)}
											label={t("panels.settledRemoval.include", { name })}
											testId="settled-removal-include"
											onChange={(include) => toggle(workspace.id, include)}
										/>
									) : (
										<span
											className={
												flag === "checking"
													? "shrink-0 text-text-subtle tr-text-metadata"
													: "shrink-0 text-feedback-warning tr-text-metadata"
											}
										>
											{flagText[flag]}
										</span>
									)}
								</li>
							);
						})}
					</ul>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={close}>
						{t("common.cancel")}
					</Button>
					<Button
						variant="destructive"
						data-testid="confirm-settled-removal"
						disabled={selected.length === 0}
						onClick={() => {
							close();
							void removeSettledWorkspaces(selected.map((row) => row.workspace));
						}}
					>
						{t("panels.settledRemoval.confirm", { count: selected.length })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
