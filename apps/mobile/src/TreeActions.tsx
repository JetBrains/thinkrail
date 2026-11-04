import {
	RiCheckDoubleLine,
	RiCloseCircleLine,
	RiDeleteBinLine,
	RiGitBranchLine,
	RiInboxArchiveLine,
	RiMailUnreadLine,
	RiMoreLine,
	RiPencilLine,
} from "@remixicon/react";
import type { Project, Workspace } from "@thinkrail/contracts";
import { T, type Translator, useT } from "@thinkrail/locales/react";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import { IconButton } from "@thinkrail/ui/button";
import { useState } from "react";
import { workspaceName } from "./ProjectsScreen";
import { ConfirmSheet, RenameSheet, Sheet, SheetAction } from "./sheet";
import type { ScopeStatus } from "./status";

/** Reports a failed tree action as "what failed: why", for the tree's banner. */
export type ReportFailure = (text: string) => void;

const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const run = (
	t: Translator,
	report: ReportFailure,
	action: string,
	request: () => Promise<unknown>,
): void => {
	void request().catch((error: unknown) =>
		report(t("mobile.tree.actionFailed", { action, reason: reasonOf(error) })),
	);
};

type Open = "menu" | "rename" | "confirm" | null;

function MoreButton({ label, onOpen }: { label: string; onOpen: () => void }) {
	return (
		<IconButton
			size="l"
			className="size-touch shrink-0"
			icon={RiMoreLine}
			label={label}
			onClick={onOpen}
		/>
	);
}

/** The project row's ⋯ — the IDE tree's project context menu: new worktree, rename, close. */
export function ProjectActions({
	project,
	client,
	onNewWorktree,
	onFailure,
}: {
	project: Project;
	client: DeviceWireClient;
	onNewWorktree: () => void;
	onFailure: ReportFailure;
}) {
	const t = useT();
	const [open, setOpen] = useState<Open>(null);
	const close = (next: boolean): void => {
		if (!next) setOpen(null);
	};
	return (
		<>
			<MoreButton
				label={t("panels.projectTree.workspaceActions", { name: project.name })}
				onOpen={() => setOpen("menu")}
			/>
			<Sheet open={open === "menu"} onOpenChange={close} title={project.name}>
				<SheetAction
					icon={RiGitBranchLine}
					label={t("mobile.tree.newWorktree")}
					onSelect={() => {
						setOpen(null);
						onNewWorktree();
					}}
				/>
				<SheetAction
					icon={RiPencilLine}
					label={t("common.rename")}
					onSelect={() => setOpen("rename")}
				/>
				<SheetAction
					icon={RiCloseCircleLine}
					label={t("panels.projectTree.closeProject")}
					destructive
					onSelect={() => setOpen("confirm")}
				/>
			</Sheet>
			<RenameSheet
				open={open === "rename"}
				onOpenChange={close}
				title={t("common.rename")}
				label={t("panels.projectTree.projectName")}
				current={project.name}
				onRename={(name) =>
					run(t, onFailure, t("panels.workspaceActions.renameProjectFailed"), () =>
						client.request("project.rename", { id: project.id, name }),
					)
				}
			/>
			<ConfirmSheet
				open={open === "confirm"}
				onOpenChange={close}
				title={t("panels.projectTree.closeTitle", { name: project.name })}
				description={t("mobile.tree.closeDescription")}
				icon={RiCloseCircleLine}
				confirmLabel={t("panels.projectTree.closeProject")}
				onConfirm={() =>
					run(t, onFailure, t("panels.projectTree.closeFailed", { name: project.name }), () =>
						client.request("project.close", { id: project.id }),
					)
				}
			/>
		</>
	);
}

/** A workspace row's ⋯ — the IDE tree's workspace menu: rename, read state, settle, remove. */
export function WorkspaceActions({
	workspace,
	client,
	status,
	onFailure,
}: {
	workspace: Workspace;
	client: DeviceWireClient;
	status: ScopeStatus;
	onFailure: ReportFailure;
}) {
	const t = useT();
	const [open, setOpen] = useState<Open>(null);
	const close = (next: boolean): void => {
		if (!next) setOpen(null);
	};
	const name = workspaceName(t, workspace);
	const external = workspace.kind === "external";
	const removable = workspace.kind !== "default";
	const busy = status.running || status.attention;
	const act = (action: string, request: () => Promise<unknown>) => (): void => {
		setOpen(null);
		run(t, onFailure, action, request);
	};
	return (
		<>
			<MoreButton
				label={t("panels.projectTree.workspaceActions", { name })}
				onOpen={() => setOpen("menu")}
			/>
			<Sheet open={open === "menu"} onOpenChange={close} title={name}>
				{removable && !external ? (
					<SheetAction
						icon={RiPencilLine}
						label={t("common.rename")}
						onSelect={() => setOpen("rename")}
					/>
				) : null}
				{status.attention ? (
					<SheetAction
						icon={RiCheckDoubleLine}
						label={t("panels.projectTree.markRead")}
						onSelect={act(t("panels.workspaceActions.markReadFailed"), () =>
							client.request("workspace.markRead", { id: workspace.id }),
						)}
					/>
				) : (
					<SheetAction
						icon={RiMailUnreadLine}
						label={t("panels.projectTree.markUnread")}
						onSelect={act(t("panels.workspaceActions.markUnreadFailed"), () =>
							client.request("workspace.markUnread", { id: workspace.id }),
						)}
					/>
				)}
				{removable ? (
					<SheetAction
						icon={RiInboxArchiveLine}
						label={t("panels.projectTree.settle")}
						detail={busy ? t("panels.projectTree.settleBlocked") : t("mobile.tree.settleDetail")}
						disabled={busy}
						onSelect={act(t("panels.workspaceActions.settleFailed"), () =>
							client.request("workspace.settle", { id: workspace.id }),
						)}
					/>
				) : null}
				{removable ? (
					<SheetAction
						icon={RiDeleteBinLine}
						label={
							external
								? t("panels.projectTree.removeExternal")
								: t("panels.projectTree.removeWorkspace")
						}
						destructive
						onSelect={() => setOpen("confirm")}
					/>
				) : null}
			</Sheet>
			<RenameSheet
				open={open === "rename"}
				onOpenChange={close}
				title={t("common.rename")}
				label={t("panels.projectTree.workspaceName")}
				current={workspace.name}
				onRename={(next) =>
					run(t, onFailure, t("panels.workspaceActions.renameWorkspaceFailed"), () =>
						client.request("workspace.rename", { id: workspace.id, name: next }),
					)
				}
			/>
			<ConfirmSheet
				open={open === "confirm"}
				onOpenChange={close}
				title={
					external
						? t("panels.removeWorkspace.titleExternal", { name })
						: t("panels.removeWorkspace.title", { name })
				}
				description={
					<T
						i18nKey={
							external
								? "panels.removeWorkspace.descriptionExternal"
								: "panels.removeWorkspace.description"
						}
						values={{ branch: workspace.branch }}
						components={[<span key="branch" className="text-text-default tr-text-emphasis" />]}
					/>
				}
				icon={RiDeleteBinLine}
				confirmLabel={external ? t("panels.removeWorkspace.confirmExternal") : t("common.remove")}
				onConfirm={() =>
					run(t, onFailure, t("panels.workspaceActions.removeFailed"), () =>
						client.request("workspace.remove", { id: workspace.id }),
					)
				}
			/>
		</>
	);
}
